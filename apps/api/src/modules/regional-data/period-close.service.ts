import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QualityService } from './quality.service';
import { assertPeriod, cleanText, currentPeriod, monthName } from './rd.util';

// ═══════════════════════════════════════════════════════════
// Oyni yopish: Hududchi tekshiruvdan o'tgan oyni «to'liq» deb tasdiqlaydi.
//  • xato bo'lsa yopilmaydi; ogohlantirishlar bo'lsa — izoh yozib yopiladi;
//  • yopilgan oyda hududlar daromadi, ish haqi va xarajatlari o'zgarmaydi;
//  • qayta ochish — faqat administrator, sababi bilan; hammasi tarixda.
// Prognoz va KPI (keyingi bosqichlar) yopilgan oylarni «tasdiqlangan» deb oladi.
// ═══════════════════════════════════════════════════════════

@Injectable()
export class PeriodCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
  ) {}

  async isClosed(period: string): Promise<boolean> {
    const row = await this.prisma.regionalPeriodClose.findUnique({ where: { period } });
    return row?.status === 'CLOSED';
  }

  /** O'zgartirishdan oldin chaqiriladi */
  async assertOpen(period: string): Promise<void> {
    if (await this.isClosed(period)) {
      throw new BadRequestException(`${monthName(period)} yopilgan — o'zgartirib bo'lmaydi. Xato bo'lsa, administrator oyni qayta ochadi`);
    }
  }

  async list(yearRaw?: string) {
    const year = /^\d{4}$/.test(String(yearRaw ?? '')) ? String(yearRaw) : currentPeriod().slice(0, 4);
    const rows = await this.prisma.regionalPeriodClose.findMany({ where: { period: { startsWith: year } }, orderBy: { period: 'asc' } });
    const ids = [...new Set(rows.flatMap((r) => [r.closedById, r.reopenedById].filter((x): x is string => Boolean(x))))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
    const un = new Map(users.map((u) => [u.id, u.fullName]));
    const last = year === currentPeriod().slice(0, 4) ? Number(currentPeriod().slice(5)) : 12;
    return Array.from({ length: last }, (_, i) => {
      const period = `${year}-${String(i + 1).padStart(2, '0')}`;
      const r = rows.find((x) => x.period === period);
      const snap = (r?.snapshot ?? {}) as { warnings?: number; note?: string };
      return {
        period,
        label: monthName(period),
        status: r?.status ?? 'OPEN',
        closedAt: r?.closedAt?.toISOString() ?? null,
        closedBy: r?.closedById ? (un.get(r.closedById) ?? null) : null,
        reopenedAt: r?.reopenedAt?.toISOString() ?? null,
        reopenedBy: r?.reopenedById ? (un.get(r.reopenedById) ?? null) : null,
        reopenReason: r?.reopenReason ?? null,
        warnings: snap.warnings ?? null,
        note: snap.note ?? null,
      };
    });
  }

  async close(periodRaw: string, noteRaw: unknown, userId: string) {
    const period = assertPeriod(periodRaw);
    if (period > currentPeriod()) throw new BadRequestException("Kelajakdagi oyni yopib bo'lmaydi");
    if (await this.isClosed(period)) throw new BadRequestException(`${monthName(period)} allaqachon yopilgan`);
    const q = await this.quality.check(period);
    if (q.errors > 0) {
      throw new BadRequestException(`Yopib bo'lmaydi: ${q.items.filter((i) => i.level === 'error').map((i) => i.title).join('; ')}`);
    }
    const note = cleanText(noteRaw, 500, 'Izoh');
    if (q.warnings > 0 && (!note || note.length < 5)) {
      throw new BadRequestException(`${q.warnings} ta ogohlantirish bor — ko'rib chiqqaningizni qisqa izohda yozing`);
    }
    const snapshot = { warnings: q.warnings, note, items: q.items.map((i) => ({ key: i.key, level: i.level, title: i.title })), stats: q.stats } as unknown as Prisma.InputJsonValue;
    await this.prisma.regionalPeriodClose.upsert({
      where: { period },
      create: { period, status: 'CLOSED', closedAt: new Date(), closedById: userId, snapshot },
      update: { status: 'CLOSED', closedAt: new Date(), closedById: userId, snapshot },
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'regional_period', entityId: period, summary: `${monthName(period)} yopildi${q.warnings ? ` (${q.warnings} ogohlantirish: ${note})` : ''}` });
    return { ok: true as const };
  }

  async reopen(periodRaw: string, reasonRaw: unknown, userId: string, role: string) {
    if (role !== 'ADMIN') throw new ForbiddenException('Oyni faqat administrator qayta ochadi');
    const period = assertPeriod(periodRaw);
    if (!(await this.isClosed(period))) throw new BadRequestException(`${monthName(period)} yopilmagan`);
    const reason = cleanText(reasonRaw, 500, 'Sabab');
    if (!reason || reason.length < 5) throw new BadRequestException('Qayta ochish sababini yozing');
    await this.prisma.regionalPeriodClose.update({ where: { period }, data: { status: 'OPEN', reopenedAt: new Date(), reopenedById: userId, reopenReason: reason } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'regional_period', entityId: period, summary: `${monthName(period)} qayta ochildi: ${reason}` });
    return { ok: true as const };
  }
}