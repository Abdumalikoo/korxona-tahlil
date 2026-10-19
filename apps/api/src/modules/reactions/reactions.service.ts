import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDays,
  cleanFilter,
  cleanKind,
  dayStart,
  daysBetween,
  isoOf,
  monthsEnding,
  ReactionMetrics,
  todayIso,
} from './reactions.metrics';
import type {
  AssigneeInput,
  AssigneeView,
  CreateReactionInput,
  ItemEvaluation,
  ItemFilter,
  ItemInput,
  ItemKind,
  ReactionDetail,
  ReactionSummary,
  UpdateReactionInput,
  Verdict,
} from './reactions.types';

const MAX_ITEMS = 40;
const MAX_DAYS = 366;
/** Bu foizdan kichik o'zgarish — "o'zgarishsiz" */
const SAME_THRESHOLD = 3;

type ReactionRow = Prisma.ReactionGetPayload<{ include: { items: true; assignees: true; _count: { select: { controls: true } } } }>;

export function fmtSom(tiyin: bigint | number): string {
  const som = Number(tiyin) / 100;
  const abs = Math.abs(som);
  const sign = som < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd so'm`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace('.', ',')} mln so'm`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)} ming so'm`;
  return `${sign}${Math.round(abs)} so'm`;
}

export function fmtPct(value: number | null, sign = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const prefix = sign && value > 0 ? '+' : value < 0 ? '−' : '';
  return `${prefix}${Math.abs(value).toFixed(1).replace('.', ',')}%`;
}

export const KIND_WORD: Record<ItemKind, string> = { INCOME: 'daromad', EXPENSE: 'xarajat', RESULT: 'natija' };

function text(value: unknown, field: string, max: number, required = true): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${field} kiritilmagan`);
    return undefined;
  }
  if (typeof value !== 'string') throw new BadRequestException(`${field} noto'g'ri`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new BadRequestException(`${field} kiritilmagan`);
  if (trimmed.length > max) throw new BadRequestException(`${field} ${max} belgidan oshmasin`);
  return trimmed || undefined;
}

/**
 * Munosabat: nomlangan savat — belgilangan moddalar, muddat va mas'ullar.
 * Har bir modda kuzatuv davrida (boshlanish → muddat) baza davri bilan avtomatik solishtiriladi.
 */
@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ReactionMetrics,
  ) {}

  // ═══════════ Kiruvchi ma'lumot ═══════════

  cleanItems(raw: unknown): ItemInput[] {
    if (!Array.isArray(raw)) throw new BadRequestException("Moddalar ro'yxati noto'g'ri");
    if (raw.length > MAX_ITEMS) throw new BadRequestException(`Bir munosabatda ${MAX_ITEMS} tadan ko'p modda bo'lmasin`);
    return raw.map((item, i) => {
      const value = (item ?? {}) as Record<string, unknown>;
      return {
        kind: cleanKind(value.kind),
        label: text(value.label, `${i + 1}-modda nomi`, 200)!,
        filter: cleanFilter(value.filter),
        origin: text(value.origin, 'Manba', 200, false),
      };
    });
  }

  async resolveAssignees(raw: unknown): Promise<{ employeePinfl: string; fullName: string; position: string | null; role: string }[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException("Mas'ullar ro'yxati noto'g'ri");
    const list = raw as AssigneeInput[];
    if (list.length > 20) throw new BadRequestException("Mas'ullar 20 tadan oshmasin");
    const pinfls = [...new Set(list.map((a) => String(a?.pinfl ?? '')))];
    if (pinfls.some((p) => !/^\d{14}$/.test(p))) throw new BadRequestException("Xodim PINFL noto'g'ri");
    const employees = await this.prisma.employee.findMany({
      where: { pinfl: { in: pinfls } },
      select: { pinfl: true, fullName: true, position: true },
    });
    const byPinfl = new Map(employees.map((e) => [e.pinfl, e]));
    return pinfls.map((pinfl) => {
      const employee = byPinfl.get(pinfl);
      if (!employee) throw new BadRequestException(`Xodim topilmadi: ${pinfl}`);
      const role = list.find((a) => a.pinfl === pinfl)?.role;
      return {
        employeePinfl: pinfl,
        fullName: employee.fullName,
        position: employee.position,
        role: typeof role === 'string' && role.trim() ? role.trim().slice(0, 40) : "Mas'ul",
      };
    });
  }

  // ═══════════ CRUD ═══════════

  async create(input: CreateReactionInput, userId: string): Promise<ReactionDetail> {
    const title = text(input?.title, 'Nomi', 160)!;
    const note = text(input?.note, 'Izoh', 2000, false);
    const start = input.startDate ? input.startDate : todayIso();
    dayStart(start);
    const due = text(input.dueDate, 'Muddat', 10)!;
    dayStart(due);
    if (due < start) throw new BadRequestException('Muddat boshlanish sanasidan oldin bo\'lmasin');
    const length = daysBetween(start, due);
    if (length > MAX_DAYS) throw new BadRequestException('Kuzatuv davri 1 yildan oshmasin');
    const items = this.cleanItems(input.items);
    if (items.length === 0) throw new BadRequestException('Kamida bitta modda belgilang');
    const assignees = await this.resolveAssignees(input.assignees);

    // Baza — boshlanishdan oldingi teng davr
    const baseTo = addDays(start, -1);
    const baseFrom = addDays(start, -length);

    const reaction = await this.prisma.reaction.create({
      data: {
        title,
        note: note ?? null,
        startDate: dayStart(start),
        dueDate: dayStart(due),
        baseFrom: dayStart(baseFrom),
        baseTo: dayStart(baseTo),
        createdById: userId,
        items: {
          create: items.map((item, i) => ({
            kind: item.kind,
            label: item.label,
            filter: item.filter as Prisma.InputJsonValue,
            origin: item.origin ?? null,
            order: i,
          })),
        },
        assignees: { create: assignees },
      },
    });
    return this.detail(reaction.id);
  }

  async update(id: string, input: UpdateReactionInput): Promise<ReactionDetail> {
    const reaction = await this.prisma.reaction.findUnique({ where: { id }, include: { items: true } });
    if (!reaction) throw new NotFoundException('Munosabat topilmadi');

    const data: Prisma.ReactionUpdateInput = {};
    if (input.title !== undefined) data.title = text(input.title, 'Nomi', 160)!;
    if (input.note !== undefined) data.note = text(input.note, 'Izoh', 2000, false) ?? null;
    if (input.dueDate !== undefined) {
      const due = text(input.dueDate, 'Muddat', 10)!;
      dayStart(due);
      const start = isoOf(reaction.startDate);
      if (due < start) throw new BadRequestException("Muddat boshlanish sanasidan oldin bo'lmasin");
      const length = daysBetween(start, due);
      if (length > MAX_DAYS) throw new BadRequestException('Kuzatuv davri 1 yildan oshmasin');
      data.dueDate = dayStart(due);
      // Baza davri ham yangi uzunlikka moslashadi
      data.baseFrom = dayStart(addDays(start, -length));
      data.baseTo = dayStart(addDays(start, -1));
    }
    if (input.status !== undefined) {
      if (input.status !== 'OPEN' && input.status !== 'CLOSED') throw new BadRequestException("Holat noto'g'ri");
      data.status = input.status;
      data.closedAt = input.status === 'CLOSED' ? new Date() : null;
    }

    const addItems = input.addItems ? this.cleanItems(input.addItems) : [];
    const removeIds = Array.isArray(input.removeItemIds) ? input.removeItemIds.map(String) : [];
    const remaining = reaction.items.length - reaction.items.filter((i) => removeIds.includes(i.id)).length + addItems.length;
    if (remaining === 0) throw new BadRequestException("Munosabatda kamida bitta modda qolishi kerak");
    if (remaining > MAX_ITEMS) throw new BadRequestException(`Bir munosabatda ${MAX_ITEMS} tadan ko'p modda bo'lmasin`);
    const assignees = input.assignees !== undefined ? await this.resolveAssignees(input.assignees) : null;

    const maxOrder = Math.max(-1, ...reaction.items.map((i) => i.order));
    await this.prisma.$transaction([
      this.prisma.reaction.update({ where: { id }, data }),
      ...(removeIds.length ? [this.prisma.reactionItem.deleteMany({ where: { reactionId: id, id: { in: removeIds } } })] : []),
      ...(addItems.length
        ? [
            this.prisma.reactionItem.createMany({
              data: addItems.map((item, i) => ({
                reactionId: id,
                kind: item.kind,
                label: item.label,
                filter: item.filter as Prisma.InputJsonValue,
                origin: item.origin ?? null,
                order: maxOrder + 1 + i,
              })),
            }),
          ]
        : []),
      ...(assignees
        ? [
            this.prisma.reactionAssignee.deleteMany({ where: { reactionId: id } }),
            this.prisma.reactionAssignee.createMany({ data: assignees.map((a) => ({ ...a, reactionId: id })) }),
          ]
        : []),
    ]);
    return this.detail(id);
  }

  async remove(id: string): Promise<void> {
    const found = await this.prisma.reaction.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Munosabat topilmadi');
    await this.prisma.reaction.delete({ where: { id } });
  }

  /** Mas'ul tanlash uchun xodimlar (Xodimlar bo'limidan) */
  async employees(search?: string) {
    const term = search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(term ? { OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { pinfl: { startsWith: term } }, { position: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      select: { pinfl: true, fullName: true, position: true, regionCode: true, region: { select: { name: true } }, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
      take: 30,
    });
    return rows.map((e) => ({
      pinfl: e.pinfl,
      fullName: e.fullName,
      position: e.position,
      place: e.department?.name ?? e.region?.name ?? '',
    }));
  }

  /** Qo'lda modda qo'shish uchun ma'lumotnomalar */
  async lookups() {
    const [regions, departments, expenseCategories, incomeCategories, vehicles] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true }, orderBy: { label: 'asc' } }),
      this.prisma.incomeCategory.findMany({ where: { isActive: true }, select: { code: true, label: true }, orderBy: { order: 'asc' } }),
      this.prisma.vehicle.findMany({ where: { deletedAt: null }, select: { id: true, plateNumber: true, model: true, regionCode: true }, orderBy: { plateNumber: 'asc' } }),
    ]);
    return {
      units: [
        { value: 'center', label: 'Markaz' },
        ...regions.filter((r) => r.code !== 0).map((r) => ({ value: `r:${r.code}`, label: r.name })),
        { value: 'none', label: 'Hududga biriktirilmagan' },
      ],
      departments: departments.map((d) => ({ value: d.id, label: d.name })),
      expenseGroups: [
        { value: 'src:PAYROLL', label: 'Ish haqi' },
        { value: 'src:LEASE', label: 'Ijara' },
        { value: 'src:VEHICLE', label: 'Mashinalar' },
        ...expenseCategories.filter((c) => c.parentCode === null && !['PAYROLL', 'LEASE', 'VEHICLE'].includes(c.code)).map((c) => ({ value: `root:${c.code}`, label: c.label })),
      ],
      expenseCategories: expenseCategories.filter((c) => c.parentCode !== null).map((c) => ({ value: c.code, label: c.label, parent: c.parentCode })),
      incomeCategories: incomeCategories.map((c) => ({ value: c.code, label: c.label })),
      vehicles: vehicles.map((v) => ({ value: v.id, label: `${v.plateNumber} · ${v.model}`, unit: v.regionCode === 0 ? 'center' : `r:${v.regionCode}` })),
    };
  }

  // ═══════════ Hisoblash ═══════════

  private async load(id: string): Promise<ReactionRow> {
    const reaction = await this.prisma.reaction.findUnique({
      where: { id },
      include: { items: { orderBy: { order: 'asc' } }, assignees: { orderBy: { createdAt: 'asc' } }, _count: { select: { controls: true } } },
    });
    if (!reaction) throw new NotFoundException('Munosabat topilmadi');
    return reaction;
  }

  private dates(reaction: ReactionRow) {
    const today = todayIso();
    const start = isoOf(reaction.startDate);
    const due = isoOf(reaction.dueDate);
    const trackTo = today < due ? today : due;
    const daysTotal = daysBetween(start, due);
    const daysPassed = trackTo < start ? 0 : daysBetween(start, trackTo);
    const daysLeft = today > due ? 0 : today < start ? daysTotal : daysBetween(today, due) - 1;
    return { today, start, due, trackTo, daysTotal, daysPassed, daysLeft, baseFrom: isoOf(reaction.baseFrom), baseTo: isoOf(reaction.baseTo) };
  }

  async evaluateItem(
    item: { id: string; kind: string; label: string; filter: unknown; origin: string | null },
    d: ReturnType<ReactionsService['dates']>,
    full: boolean,
  ): Promise<ItemEvaluation> {
    const kind = item.kind as ItemKind;
    const filter = (item.filter ?? {}) as ItemFilter;
    const baseDays = daysBetween(d.baseFrom, d.baseTo);
    const trackDays = d.daysPassed;

    const [baseSum, trackSum] = await Promise.all([
      this.metrics.sumDates(kind, filter, d.baseFrom, d.baseTo),
      trackDays > 0 ? this.metrics.sumDates(kind, filter, d.start, d.trackTo) : Promise.resolve(0n),
    ]);
    const basePerDay = baseDays > 0 ? Number(baseSum) / baseDays : 0;
    const trackPerDay = trackDays > 0 ? Number(trackSum) / trackDays : 0;
    const expected = Math.round(basePerDay * trackDays);
    const effect = Number(trackSum) - expected;
    const changePercent = trackDays > 0 && basePerDay !== 0 ? ((trackPerDay - basePerDay) / Math.abs(basePerDay)) * 100 : null;

    let verdict: Verdict;
    if (trackDays === 0) verdict = 'nodata';
    else if (changePercent === null) verdict = trackSum === 0n ? 'same' : kind === 'EXPENSE' ? 'worse' : 'better';
    else if (Math.abs(changePercent) < SAME_THRESHOLD) verdict = 'same';
    else verdict = (kind === 'EXPENSE' ? changePercent < 0 : changePercent > 0) ? 'better' : 'worse';

    const word = KIND_WORD[kind];
    const verdictText =
      verdict === 'nodata'
        ? 'Kuzatuv hali boshlanmagan'
        : verdict === 'same'
          ? `O'zgarishsiz (${fmtPct(changePercent, true)})`
          : verdict === 'better'
            ? kind === 'EXPENSE'
              ? `Xarajat kamaydi (${fmtPct(changePercent, true)})`
              : `${word[0]!.toUpperCase() + word.slice(1)} oshdi (${fmtPct(changePercent, true)})`
            : kind === 'EXPENSE'
              ? `Xarajat oshdi (${fmtPct(changePercent, true)})`
              : `${word[0]!.toUpperCase() + word.slice(1)} kamaydi (${fmtPct(changePercent, true)})`;

    const months = monthsEnding(d.today.slice(0, 7), 24);
    const [monthly, topRecords] = full
      ? await Promise.all([this.metrics.monthly(kind, filter, months), this.metrics.topRecords(kind, filter, d.start, d.trackTo < d.start ? d.start : d.trackTo)])
      : [months.map(() => 0n), []];

    const notes: string[] = [];
    if (trackDays > 0) {
      notes.push(
        `Belgilashdan oldingi ${baseDays} kunda ${word} ${fmtSom(baseSum)} (kuniga ${fmtSom(Math.round(basePerDay))}) bo'lgan.`,
        `Kuzatuvning ${trackDays} kunida ${fmtSom(trackSum)} (kuniga ${fmtSom(Math.round(trackPerDay))}); avvalgi sur'at bilan ${fmtSom(expected)} bo'lishi kutilgan edi.`,
      );
      if (effect !== 0) {
        const good = kind === 'EXPENSE' ? effect < 0 : effect > 0;
        notes.push(
          kind === 'EXPENSE'
            ? good
              ? `Natijada ${fmtSom(-effect)} tejaldi.`
              : `Natijada kutilganidan ${fmtSom(effect)} ortiq sarflandi.`
            : good
              ? `Natijada kutilganidan ${fmtSom(effect)} ko'p ${kind === 'RESULT' ? 'natija' : 'daromad'} olindi.`
              : `Natijada kutilganidan ${fmtSom(-effect)} kam ${kind === 'RESULT' ? 'natija' : 'daromad'} olindi.`,
        );
      }
    } else {
      notes.push(`Kuzatuv ${d.start} kuni boshlanadi. Baza: ${baseDays} kunda ${fmtSom(baseSum)} (kuniga ${fmtSom(Math.round(basePerDay))}).`);
    }

    const window = (from: string, to: string, days: number, sum: bigint, perDay: number) => ({
      from,
      to,
      days,
      sumTiyin: sum.toString(),
      perDayTiyin: String(Math.round(perDay)),
    });

    return {
      id: item.id,
      kind,
      label: item.label,
      filter,
      origin: item.origin,
      base: window(d.baseFrom, d.baseTo, baseDays, baseSum, basePerDay),
      track: window(d.start, d.trackTo < d.start ? d.start : d.trackTo, trackDays, trackSum, trackPerDay),
      expectedTiyin: String(expected),
      effectTiyin: String(effect),
      changePercent: changePercent === null ? null : Math.round(changePercent * 10) / 10,
      verdict,
      verdictText,
      months,
      monthly: monthly.map((v) => v.toString()),
      topRecords,
      notes,
    };
  }

  private summaryOf(reaction: ReactionRow, d: ReturnType<ReactionsService['dates']>, items: ItemEvaluation[]): ReactionSummary {
    const gain = items.reduce((s, i) => s + (i.kind === 'EXPENSE' ? -Number(i.effectTiyin) : Number(i.effectTiyin)), 0);
    const assignees: AssigneeView[] = reaction.assignees.map((a) => ({ pinfl: a.employeePinfl, fullName: a.fullName, position: a.position, role: a.role }));
    return {
      id: reaction.id,
      title: reaction.title,
      note: reaction.note,
      status: reaction.status,
      startDate: d.start,
      dueDate: d.due,
      baseFrom: d.baseFrom,
      baseTo: d.baseTo,
      createdAt: reaction.createdAt.toISOString(),
      closedAt: reaction.closedAt?.toISOString() ?? null,
      daysTotal: d.daysTotal,
      daysPassed: d.daysPassed,
      daysLeft: d.daysLeft,
      overdue: reaction.status === 'OPEN' && d.today > d.due,
      itemCount: reaction.items.length,
      assignees,
      better: items.filter((i) => i.verdict === 'better').length,
      worse: items.filter((i) => i.verdict === 'worse').length,
      same: items.filter((i) => i.verdict === 'same').length,
      gainTiyin: String(Math.round(gain)),
      controlCount: reaction._count.controls,
    };
  }

  async list(status?: string): Promise<ReactionSummary[]> {
    const where: Prisma.ReactionWhereInput = status === 'OPEN' || status === 'CLOSED' || status === 'CONTROL' ? { status } : {};
    const reactions = await this.prisma.reaction.findMany({
      where,
      include: { items: { orderBy: { order: 'asc' } }, assignees: { orderBy: { createdAt: 'asc' } }, _count: { select: { controls: true } } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
    const result: ReactionSummary[] = [];
    for (const reaction of reactions) {
      const d = this.dates(reaction);
      const items = await Promise.all(reaction.items.map((item) => this.evaluateItem(item, d, false)));
      result.push(this.summaryOf(reaction, d, items));
    }
    return result;
  }

  /** full = false — oylik qatorlar va yirik yozuvlarsiz (yig'ma hisobotlar uchun tezroq) */
  async detail(id: string, full = true): Promise<ReactionDetail> {
    const reaction = await this.load(id);
    const d = this.dates(reaction);
    const items = await Promise.all(reaction.items.map((item) => this.evaluateItem(item, d, full)));
    const summary = this.summaryOf(reaction, d, items);
    return { ...summary, items, conclusions: this.conclusions(summary, items) };
  }

  private conclusions(summary: ReactionSummary, items: ItemEvaluation[]): string[] {
    const notes: string[] = [];
    if (summary.daysPassed === 0) {
      notes.push(`Kuzatuv ${summary.startDate} kuni boshlanadi, muddat — ${summary.dueDate} (${summary.daysTotal} kun).`);
      return notes;
    }
    notes.push(
      `Kuzatuvning ${summary.daysPassed}-kuni (jami ${summary.daysTotal} kun)` +
        (summary.status === 'OPEN' ? (summary.overdue ? ' — muddat tugagan.' : `, muddatgacha ${summary.daysLeft} kun qoldi.`) : '.'),
    );
    notes.push(`${items.length} ta moddadan ${summary.better} tasi yaxshilandi, ${summary.worse} tasi yomonlashdi, ${summary.same} tasi o'zgarmadi.`);
    const gain = Number(summary.gainTiyin);
    if (gain !== 0) {
      notes.push(gain > 0 ? `Umumiy ijobiy ta'sir: ${fmtSom(gain)} (tejalgan xarajat va qo'shimcha daromad).` : `Umumiy salbiy ta'sir: ${fmtSom(-gain)} — vaziyat avvalgidan yomonlashgan.`);
    }
    const worst = [...items]
      .filter((i) => i.verdict === 'worse')
      .sort((a, b) => Math.abs(Number(b.effectTiyin)) - Math.abs(Number(a.effectTiyin)))[0];
    if (worst) notes.push(`Eng ko'p e'tibor talab qiladigan modda — «${worst.label}»: ${worst.verdictText.toLowerCase()}.`);
    const best = [...items]
      .filter((i) => i.verdict === 'better')
      .sort((a, b) => Math.abs(Number(b.effectTiyin)) - Math.abs(Number(a.effectTiyin)))[0];
    if (best) notes.push(`Eng yaxshi natija — «${best.label}»: ${best.verdictText.toLowerCase()}.`);
    if (summary.assignees.length === 0) notes.push("Mas'ul xodim biriktirilmagan — kamida bitta mas'ul belgilash tavsiya etiladi.");
    if (summary.status === 'OPEN' && summary.overdue) {
      notes.push(
        summary.worse > 0
          ? "Muddat tugadi, lekin ayrim moddalar yaxshilanmadi — ularni Nazoratga o'tkazib, oylik chegara qo'yish tavsiya etiladi."
          : "Muddat tugadi va moddalar yomonlashmadi — munosabatni yopish yoki natijani saqlash uchun Nazoratga o'tkazish mumkin.",
      );
    }
    return notes;
  }
}