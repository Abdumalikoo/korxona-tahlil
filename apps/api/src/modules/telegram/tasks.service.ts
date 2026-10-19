import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma, TaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { esc, fmtDeadline, TelegramService } from './telegram.service';

// ═══════════════════════════════════════════════════════════
// Topshiriqlar: xodimga muddatli ish. Har topshiriqqa eslatma soatlari beriladi
// (masalan muddatdan 24 va 2 soat oldin, 0 — muddat vaqtida). Har daqiqada yuborilishi
// kerak bo'lganlari Telegramga jo'natiladi: «Sizning shu ishingiz bajarilishi kerak».
// Xodim botga ulanmagan bo'lsa — eslatma kutib turadi (5 urinish), sabab ro'yxatda ko'rinadi.
// ═══════════════════════════════════════════════════════════

const HOUR = 3_600_000;
const MAX_ATTEMPTS = 5;
const DEFAULT_HOURS = [24, 2];

export interface TaskInput {
  title?: string;
  description?: string | null;
  /** "YYYY-MM-DDTHH:mm" — Toshkent vaqti */
  deadline?: string;
  pinfl?: string;
  remindHours?: number[];
  /** Topshiriq berilganda darhol ham yuborilsin */
  sendNow?: boolean;
}

export interface ReminderView {
  id: string;
  hoursBefore: number;
  dueAt: string;
  sentAt: string | null;
  error: string | null;
  attempts: number;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  pinfl: string;
  employeeName: string;
  position: string | null;
  linked: boolean;
  remindHours: number[];
  status: TaskStatus;
  overdue: boolean;
  createdByName: string | null;
  createdAt: string;
  doneAt: string | null;
  reminders: ReminderView[];
}

/** "2026-10-15T18:00" (Toshkent) → Date */
function parseDeadline(raw: unknown): Date {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw.trim()) : null;
  if (!m) throw new BadRequestException("Muddat noto'g'ri (sana va soat)");
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi) - 5 * HOUR);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("Muddat noto'g'ri");
  return date;
}

function cleanHours(raw: unknown): number[] {
  if (raw === undefined || raw === null) return DEFAULT_HOURS;
  if (!Array.isArray(raw)) throw new BadRequestException("Eslatma soatlari noto'g'ri");
  const list = [...new Set(raw.map((x) => Number(x)))];
  if (list.some((h) => !Number.isInteger(h) || h < 0 || h > 720)) throw new BadRequestException("Eslatma soati 0 dan 720 gacha butun son bo'lsin");
  if (list.length > 6) throw new BadRequestException("6 tadan ko'p eslatma bo'lmasin");
  return list.sort((a, b) => b - a);
}

/** "1 kun 2 soat", "45 daqiqa" */
function leftText(ms: number): string {
  if (ms <= 0) return 'muddat keldi';
  const totalMin = Math.round(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} kun${hours ? ` ${hours} soat` : ''}`;
  if (hours > 0) return `${hours} soat${mins >= 5 ? ` ${mins} daqiqa` : ''}`;
  return `${Math.max(1, mins)} daqiqa`;
}

type TaskRow = Prisma.TaskGetPayload<{ include: { reminders: true } }>;

@Injectable()
export class TasksService {
  private readonly log = new Logger('Topshiriqlar');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly audit: AuditService,
  ) {}

  // ═══════════ Ko'rish ═══════════

  async list(filter: { status?: string } = {}): Promise<TaskView[]> {
    const now = new Date();
    const where: Prisma.TaskWhereInput =
      filter.status === 'done'
        ? { status: 'DONE' }
        : filter.status === 'cancelled'
          ? { status: 'CANCELLED' }
          : filter.status === 'overdue'
            ? { status: 'OPEN', deadline: { lt: now } }
            : filter.status === 'all'
              ? {}
              : { status: 'OPEN' };
    const rows = await this.prisma.task.findMany({
      where,
      include: { reminders: true },
      orderBy: filter.status === 'done' || filter.status === 'cancelled' ? { updatedAt: 'desc' } : { deadline: 'asc' },
      take: 500,
    });
    return this.views(rows);
  }

  async get(id: string): Promise<TaskView> {
    const row = await this.prisma.task.findUnique({ where: { id }, include: { reminders: true } });
    if (!row) throw new NotFoundException('Topshiriq topilmadi');
    return (await this.views([row]))[0]!;
  }

  private async views(rows: TaskRow[]): Promise<TaskView[]> {
    const pinfls = [...new Set(rows.map((r) => r.pinfl))];
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
    const [links, people, users] = await Promise.all([
      pinfls.length ? this.prisma.telegramLink.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true } }) : [],
      pinfls.length ? this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, position: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const linked = new Set(links.map((l) => l.pinfl));
    const position = new Map(people.map((p) => [p.pinfl, p.position]));
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      deadline: r.deadline.toISOString(),
      pinfl: r.pinfl,
      employeeName: r.employeeName,
      position: position.get(r.pinfl) ?? null,
      linked: linked.has(r.pinfl),
      remindHours: r.remindHours,
      status: r.status,
      overdue: r.status === 'OPEN' && r.deadline.getTime() < now,
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      doneAt: r.doneAt ? r.doneAt.toISOString() : null,
      reminders: [...r.reminders]
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .map((m) => ({ id: m.id, hoursBefore: m.hoursBefore, dueAt: m.dueAt.toISOString(), sentAt: m.sentAt ? m.sentAt.toISOString() : null, error: m.error, attempts: m.attempts })),
    }));
  }

  /** Topshiriq beriladigan xodimlar (qidiruv) — Telegramga ulanganmi bilan */
  async employees(search?: string) {
    const term = search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(term ? { OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { pinfl: { startsWith: term } }, { position: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      select: { pinfl: true, fullName: true, position: true },
      orderBy: { fullName: 'asc' },
      take: 30,
    });
    const links = rows.length ? await this.prisma.telegramLink.findMany({ where: { pinfl: { in: rows.map((r) => r.pinfl) } }, select: { pinfl: true } }) : [];
    const linked = new Set(links.map((l) => l.pinfl));
    return rows.map((r) => ({ ...r, linked: linked.has(r.pinfl) }));
  }

  // ═══════════ Kiritish ═══════════

  private async validate(input: TaskInput, base?: TaskRow) {
    const title = (input.title ?? base?.title ?? '').trim();
    if (title.length < 2) throw new BadRequestException('Topshiriq matnini yozing');
    if (title.length > 300) throw new BadRequestException("Topshiriq 300 belgidan oshmasin — batafsili izohga");
    const descRaw = input.description !== undefined ? input.description : base?.description;
    const description = typeof descRaw === 'string' && descRaw.trim() ? descRaw.trim().slice(0, 2000) : null;
    const deadline = input.deadline !== undefined ? parseDeadline(input.deadline) : base!.deadline;
    if ((!base || input.deadline !== undefined) && deadline.getTime() < Date.now() - 60_000) throw new BadRequestException("Muddat o'tib ketgan — kelajakdagi vaqtni tanlang");
    const pinfl = (input.pinfl ?? base?.pinfl ?? '').trim();
    const employee = await this.prisma.employee.findUnique({ where: { pinfl }, select: { pinfl: true, fullName: true } });
    if (!employee) throw new BadRequestException('Xodimni tanlang');
    const remindHours = input.remindHours !== undefined ? cleanHours(input.remindHours) : (base?.remindHours ?? DEFAULT_HOURS);
    return { title, description, deadline, pinfl, employeeName: employee.fullName, remindHours };
  }

  /** Kelajakdagi eslatmalar (o'tib ketgan soatlar yaratilmaydi) */
  private plan(deadline: Date, hours: number[], sendNow: boolean) {
    const now = Date.now();
    const rows: { hoursBefore: number; dueAt: Date }[] = [];
    if (sendNow) rows.push({ hoursBefore: -1, dueAt: new Date(now) });
    for (const h of hours) {
      const dueAt = new Date(deadline.getTime() - h * HOUR);
      if (dueAt.getTime() > now) rows.push({ hoursBefore: h, dueAt });
    }
    return rows;
  }

  async create(input: TaskInput, userId: string): Promise<TaskView> {
    const data = await this.validate(input ?? {});
    const task = await this.prisma.task.create({
      data: {
        ...data,
        createdById: userId,
        reminders: { create: this.plan(data.deadline, data.remindHours, input?.sendNow !== false) },
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'task', entityId: task.id, summary: `Topshiriq: ${data.employeeName} — ${data.title}` });
    await this.processDue();
    return this.get(task.id);
  }

  /** Tahrirlash: yuborilmagan eslatmalar yangi muddat va soatlarga qayta tuziladi */
  async update(id: string, input: TaskInput, userId: string): Promise<TaskView> {
    const base = await this.prisma.task.findUnique({ where: { id }, include: { reminders: true } });
    if (!base) throw new NotFoundException('Topshiriq topilmadi');
    if (base.status !== 'OPEN') throw new BadRequestException('Faqat ochiq topshiriq tahrirlanadi');
    const data = await this.validate(input ?? {}, base);
    const changedPlan = data.deadline.getTime() !== base.deadline.getTime() || data.remindHours.join() !== base.remindHours.join() || data.pinfl !== base.pinfl;
    await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data });
      if (changedPlan) {
        await tx.taskReminder.deleteMany({ where: { taskId: id, sentAt: null } });
        const plan = this.plan(data.deadline, data.remindHours, false);
        for (const r of plan) await tx.taskReminder.create({ data: { taskId: id, ...r } });
      }
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'task', entityId: id, summary: `Topshiriq o'zgartirildi: ${data.title}` });
    return this.get(id);
  }

  async setStatus(id: string, status: TaskStatus, userId: string): Promise<TaskView> {
    const base = await this.prisma.task.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('Topshiriq topilmadi');
    await this.prisma.task.update({
      where: { id },
      data: { status, doneAt: status === 'DONE' ? new Date() : null, doneById: status === 'DONE' ? userId : null },
    });
    // Qayta ochilsa — kelajakdagi eslatmalar tiklanadi
    if (status === 'OPEN') {
      await this.prisma.taskReminder.deleteMany({ where: { taskId: id, sentAt: null } });
      for (const r of this.plan(base.deadline, base.remindHours, false)) await this.prisma.taskReminder.create({ data: { taskId: id, ...r } });
    }
    const word = status === 'DONE' ? 'bajarildi' : status === 'CANCELLED' ? 'bekor qilindi' : 'qayta ochildi';
    await this.audit.log({ userId, action: 'UPDATE', entity: 'task', entityId: id, summary: `Topshiriq ${word}: ${base.title}` });
    return this.get(id);
  }

  async remove(id: string, userId: string): Promise<{ id: string }> {
    const base = await this.prisma.task.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('Topshiriq topilmadi');
    await this.prisma.taskReminder.deleteMany({ where: { taskId: id } });
    await this.prisma.task.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'task', entityId: id, summary: `Topshiriq o'chirildi: ${base.title}` });
    return { id };
  }

  /** «Hozir yuborish» — darhol bitta xabar */
  async remindNow(id: string, userId: string): Promise<TaskView> {
    const base = await this.prisma.task.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('Topshiriq topilmadi');
    if (base.status !== 'OPEN') throw new BadRequestException('Topshiriq ochiq emas');
    if (!this.telegram.configured) throw new BadRequestException('Telegram bot ulanmagan (Sozlamalar › Telegram)');
    const link = await this.prisma.telegramLink.findUnique({ where: { pinfl: base.pinfl } });
    if (!link) throw new BadRequestException(`${base.employeeName} hali Telegram botga ulanmagan — unga shaxsiy havolani yuboring`);
    await this.prisma.taskReminder.create({ data: { taskId: id, hoursBefore: -1, dueAt: new Date() } });
    await this.processDue();
    await this.audit.log({ userId, action: 'UPDATE', entity: 'task', entityId: id, summary: `Topshiriq Telegramga qayta yuborildi: ${base.title}` });
    return this.get(id);
  }

  // ═══════════ Yuborish (har daqiqada) ═══════════

  private text(task: { title: string; description: string | null; deadline: Date; createdById: string | null }, hoursBefore: number, by: string | null): string {
    const left = task.deadline.getTime() - Date.now();
    const head =
      hoursBefore < 0
        ? '📌 <b>Sizga topshiriq berildi</b>'
        : hoursBefore === 0 || left <= 0
          ? '❗ <b>Topshiriq muddati keldi</b>'
          : `⏰ <b>Eslatma:</b> muddatgacha ${leftText(left)} qoldi`;
    const lines = [
      head,
      '',
      `<b>${esc(task.title)}</b>`,
      ...(task.description ? [esc(task.description)] : []),
      '',
      `🗓 Muddat: <b>${fmtDeadline(task.deadline)}</b>`,
      ...(by ? [`👤 Topshiriq berdi: ${esc(by)}`] : []),
      '',
      'Sizning shu ishingiz belgilangan muddatgacha bajarilishi kerak.',
    ];
    return lines.join('\n');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<{ sent: number; failed: number }> {
    if (this.running || !this.telegram.configured) return { sent: 0, failed: 0 };
    this.running = true;
    let sent = 0;
    let failed = 0;
    try {
      const now = new Date();
      const due = await this.prisma.taskReminder.findMany({
        where: { sentAt: null, dueAt: { lte: now }, attempts: { lt: MAX_ATTEMPTS }, task: { status: 'OPEN' } },
        include: { task: true },
        orderBy: { dueAt: 'asc' },
        take: 200,
      });
      for (const r of due) {
        // Server o'chiq turgan bo'lsa: muddati 1 soatdan ko'p o'tgan eslatmalar yuborilmaydi
        if (r.hoursBefore > 0 && r.task.deadline.getTime() < now.getTime() - HOUR) {
          await this.prisma.taskReminder.update({ where: { id: r.id }, data: { attempts: MAX_ATTEMPTS, error: "Vaqti o'tib ketgan (server o'chiq edi)" } });
          continue;
        }
        // Bir eslatma ikki marta ketmasligi uchun avval «egallab» olinadi (5 daqiqadan eskisi qayta olinadi)
        const claim = await this.prisma.taskReminder.updateMany({
          where: { id: r.id, sentAt: null, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - 5 * 60_000) } }] },
          data: { claimedAt: new Date() },
        });
        if (claim.count === 0) continue;
        const link = await this.prisma.telegramLink.findUnique({ where: { pinfl: r.task.pinfl } });
        if (!link) {
          await this.prisma.taskReminder.update({ where: { id: r.id }, data: { attempts: { increment: 1 }, claimedAt: null, error: 'Xodim Telegram botga ulanmagan' } });
          failed += 1;
          continue;
        }
        const by = r.task.createdById ? ((await this.prisma.user.findUnique({ where: { id: r.task.createdById }, select: { fullName: true } }))?.fullName ?? null) : null;
        try {
          await this.telegram.send(link.chatId, this.text(r.task, r.hoursBefore, by));
          await this.prisma.taskReminder.update({ where: { id: r.id }, data: { sentAt: new Date(), error: null, attempts: { increment: 1 } } });
          sent += 1;
        } catch (error) {
          await this.prisma.taskReminder.update({ where: { id: r.id }, data: { attempts: { increment: 1 }, claimedAt: null, error: (error as Error).message.slice(0, 300) } });
          failed += 1;
        }
      }
    } catch (error) {
      this.log.warn((error as Error).message);
    } finally {
      this.running = false;
    }
    return { sent, failed };
  }
}