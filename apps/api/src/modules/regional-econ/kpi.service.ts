import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriod, currentPeriod, monthName, shiftPeriod } from '../regional-data/rd.util';
import { loadLookups, loadMonths, PAYROLL_CATEGORY } from './econ.loader';
import { ForecastService } from './forecast.service';
import { PotentialService } from './potential.service';

// ═══════════════════════════════════════════════════════════
// H. Hudud KPI: model taklifi → taklif etilgan qiymat → tasdiqlangan → fakt va bajarilish.
//   Daromad taklifi  = salohiyat (C) shu oy uchun;
//   Xarajat taklifi  = «Xarajat rejasi» (bo'lsa), aks holda prognoz (ish haqi + xarajat);
//   Natija taklifi   = daromad taklifi − xarajat taklifi.
// Taklif shu oydan oldingi ma'lumot bilan hisoblanadi (o'tgan oy uchun ham — natijani bilmasdan).
// Bajarilish: daromad va natija — fakt ÷ maqsad; xarajat — maqsad ÷ fakt (kam sarf — yaxshi).
// Har bir qadam (taklif, o'zgartirish, tasdiq, rad, qayta ochish) tarixda qoladi.
// ═══════════════════════════════════════════════════════════

export const METRICS = {
  REVENUE: { label: 'Daromad', up: true },
  EXPENSE: { label: 'Xarajat (ish haqi + boshqa)', up: false },
  RESULT: { label: 'Operatsion natija', up: true },
} as const;
export type Metric = keyof typeof METRICS;
const METRIC_KEYS = Object.keys(METRICS) as Metric[];

export const ACTION_LABELS: Record<string, string> = {
  SUGGEST: 'Model taklifi hisoblandi',
  PROPOSE: 'Qiymat taklif etildi',
  APPROVE: 'Tasdiqlandi',
  REJECT: 'Rad etildi',
  REOPEN: 'Qayta ochildi',
};

const T = (x: number | bigint) => (typeof x === 'bigint' ? x.toString() : String(Math.round(x)));

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

function parseSigned(raw: unknown, label: string): bigint {
  const s = String(raw ?? '').trim();
  if (!/^-?\d{1,18}$/.test(s)) throw new BadRequestException(`${label}: butun son (tiyin) kiriting`);
  return BigInt(s);
}

/** Bajarilish (ulush) va holat */
export function achievement(metric: Metric, target: bigint | null, actual: bigint | null): { ratio: number | null; state: 'met' | 'near' | 'missed' | 'none' } {
  if (target === null || actual === null) return { ratio: null, state: 'none' };
  const up = METRICS[metric].up;
  const t = Number(target);
  const a = Number(actual);
  let ratio: number | null = null;
  if (up) ratio = t > 0 ? a / t : null;
  else ratio = a > 0 ? t / a : t >= 0 ? 1 : null;
  if (ratio === null) return { ratio: null, state: up ? (a >= t ? 'met' : 'missed') : a <= t ? 'met' : 'missed' };
  return { ratio, state: ratio >= 1 ? 'met' : ratio >= 0.95 ? 'near' : 'missed' };
}

@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly potentials: PotentialService,
    private readonly forecasts: ForecastService,
  ) {}

  async list(periodRaw?: string) {
    const cur = currentPeriod();
    const period = periodRaw ? assertPeriod(periodRaw) : cur;
    const lk = await loadLookups(this.prisma);
    const [rows, closes] = await Promise.all([
      this.prisma.kpiTarget.findMany({ where: { period } }),
      this.prisma.regionalPeriodClose.findMany({ where: { period }, select: { period: true } }),
    ]);
    const logRows = rows.length ? await this.prisma.kpiTargetLog.findMany({ where: { targetId: { in: rows.map((r) => r.id) } }, select: { targetId: true } }) : [];
    const logCount = new Map<string, number>();
    for (const l of logRows) logCount.set(l.targetId, (logCount.get(l.targetId) ?? 0) + 1);
    const timing: 'past' | 'running' | 'future' = period < cur ? 'past' : period === cur ? 'running' : 'future';
    const months = timing === 'future' ? [] : await loadMonths(this.prisma, [period], lk);
    const m = months[0];
    const actualOf = (code: number, metric: Metric): bigint | null => {
      if (!m) return null;
      const r = m.regions.get(code);
      if (!r) return 0n;
      const exp = r.payroll + r.opex;
      return metric === 'REVENUE' ? r.revenue : metric === 'EXPENSE' ? exp : r.revenue - exp;
    };
    const userIds = [...new Set(rows.flatMap((r) => [r.updatedById, r.approvedById].filter((x): x is string => !!x)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const uname = new Map(users.map((u) => [u.id, u.fullName]));
    const counts = { DRAFT: 0, PROPOSED: 0, APPROVED: 0, missing: 0 };
    const states = { met: 0, near: 0, missed: 0 };
    const totals = Object.fromEntries(METRIC_KEYS.map((k) => [k, { approved: 0n, actual: 0n, regions: 0 }])) as Record<Metric, { approved: bigint; actual: bigint; regions: number }>;
    const regions = lk.regions.map((reg) => ({
      code: reg.code,
      name: reg.name,
      metrics: METRIC_KEYS.map((metric) => {
        const row = rows.find((r) => r.regionCode === reg.code && r.metric === metric) ?? null;
        const actual = actualOf(reg.code, metric);
        const target = row?.approvedTiyin ?? null;
        // Joriy oy tugamagan — qisman fakt bilan bajarilish hisoblanmaydi
        const ach = timing === 'past' ? achievement(metric, target, actual) : { ratio: null, state: 'none' as const };
        if (!row) counts.missing++;
        else counts[row.status as 'DRAFT' | 'PROPOSED' | 'APPROVED']++;
        if (ach.state !== 'none') states[ach.state]++;
        if (target !== null && actual !== null) {
          totals[metric].approved += target;
          totals[metric].actual += actual;
          totals[metric].regions++;
        }
        return {
          metric,
          label: METRICS[metric].label,
          up: METRICS[metric].up,
          id: row?.id ?? null,
          status: row?.status ?? null,
          suggestedTiyin: row ? T(row.suggestedTiyin) : null,
          basis: (row?.suggestBasis ?? null) as Record<string, unknown> | null,
          proposedTiyin: row?.proposedTiyin != null ? T(row.proposedTiyin) : null,
          approvedTiyin: target !== null ? T(target) : null,
          approvedBy: row?.approvedById ? (uname.get(row.approvedById) ?? null) : null,
          approvedAt: row?.approvedAt ?? null,
          note: row?.note ?? null,
          actualTiyin: actual === null ? null : T(actual),
          achievement: ach.ratio,
          state: ach.state,
          history: row ? (logCount.get(row.id) ?? 0) : 0,
        };
      }),
    }));
    return {
      period,
      label: monthName(period),
      timing,
      closed: closes.length > 0,
      metrics: METRIC_KEYS.map((k) => ({ key: k, label: METRICS[k].label, up: METRICS[k].up })),
      counts,
      states,
      totals: METRIC_KEYS.map((k) => ({ metric: k, label: METRICS[k].label, approvedTiyin: T(totals[k].approved), actualTiyin: T(totals[k].actual), regions: totals[k].regions, achievement: timing === 'past' && totals[k].regions ? achievement(k, totals[k].approved, totals[k].actual).ratio : null })),
      regions,
      method: [
        "Daromad taklifi — shu oy uchun salohiyat (Salohiyat bo'limi: barqaror oyna o'rtachasi × o'rtacha o'sish; 24 oydan ko'p ma'lumot bo'lsa — mavsum indeksi bilan).",
        "Xarajat taklifi — «Xarajat rejasi» (ish haqi va boshqa moddalar); rejada qaysi qism bo'lmasa — o'sha qism prognozdan (ish haqi xodimlar bo'yicha, xarajat modeli).",
        'Natija taklifi = daromad taklifi − xarajat taklifi.',
        "Taklif shu oydan oldingi ma'lumot bilan hisoblanadi — o'tgan oylar uchun ham natijani bilmasdan.",
        "Bajarilish: daromad va natija — fakt ÷ maqsad; xarajat — maqsad ÷ fakt (kam sarf — yaxshi). 100% va undan yuqori — bajarildi, 95–100% — yaqin.",
        "Taklifdan 5% dan ko'p farq qiladigan qiymat va tasdiqda o'zgartirish — izoh bilan. Har bir qadam tarixda saqlanadi.",
      ],
    };
  }

  /** Model takliflarini hisoblash (faqat qoralama va yangi qatorlar yangilanadi) */
  async generate(periodRaw: string, userId: string) {
    const period = assertPeriod(periodRaw);
    const cur = currentPeriod();
    const lastFull = shiftPeriod(cur, -1);
    const prev = shiftPeriod(period, -1);
    const base = prev < lastFull ? prev : lastFull;
    const k = monthsBetween(base, period);
    if (k < 1 || k > 12) throw new BadRequestException("KPI taklifi joriy oydan 11 oygacha oldinga hisoblanadi");
    const [pot, fc, budgets, existing] = await Promise.all([
      this.potentials.potential(base, k),
      this.forecasts.forecast(base, k),
      this.prisma.expenseBudget.findMany({ where: { period }, select: { regionCode: true, amountTiyin: true, categoryCode: true } }),
      this.prisma.kpiTarget.findMany({ where: { period } }),
    ]);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const r of pot.regions) {
      if (!r.hasData) continue;
      const fr = fc.regions.find((x) => x.code === r.code);
      const potRev = Number(r.aheadSeasonal[k - 1] ?? 0);
      const fcRev = Number(fr?.revenue.forecast[k - 1]?.meanTiyin ?? 0);
      const fcPay = Number(fr?.payroll.forecast[k - 1]?.meanTiyin ?? 0);
      const fcOpex = Number(fr?.opex.forecast[k - 1]?.meanTiyin ?? 0);
      const fcExp = fcPay + fcOpex;
      // Reja bo'lsa — reja; rejada ish haqi yoki boshqa moddalar bo'lmasa, o'sha qism prognozdan
      const bRows = budgets.filter((b) => b.regionCode === r.code);
      const bPay = bRows.filter((b) => b.categoryCode === PAYROLL_CATEGORY);
      const bOpex = bRows.filter((b) => b.categoryCode !== PAYROLL_CATEGORY);
      const budget = bRows.length ? bRows.reduce((s, b) => s + Number(b.amountTiyin), 0) : null;
      const revenue = potRev > 0 ? potRev : fcRev;
      const expense = (bPay.length ? bPay.reduce((s, b) => s + Number(b.amountTiyin), 0) : fcPay) + (bOpex.length ? bOpex.reduce((s, b) => s + Number(b.amountTiyin), 0) : fcOpex);
      const basis = {
        base,
        baseLabel: monthName(base),
        step: k,
        potentialTiyin: T(potRev),
        forecastRevenueTiyin: T(fcRev),
        forecastExpenseTiyin: T(fcExp),
        budgetTiyin: budget === null ? null : T(budget),
        revenueSource: potRev > 0 ? 'POTENTIAL' : 'FORECAST',
        expenseSource: budget === null ? 'FORECAST' : bPay.length && bOpex.length ? 'BUDGET' : 'MIXED',
      };
      const values: Record<Metric, number> = { REVENUE: revenue, EXPENSE: expense, RESULT: revenue - expense };
      for (const metric of METRIC_KEYS) {
        const v = BigInt(Math.round(values[metric]));
        const row = existing.find((x) => x.regionCode === r.code && x.metric === metric);
        if (!row) {
          const c = await this.prisma.kpiTarget.create({ data: { period, regionCode: r.code, metric, suggestedTiyin: v, suggestBasis: basis, status: 'DRAFT', updatedById: userId } });
          await this.prisma.kpiTargetLog.create({ data: { targetId: c.id, action: 'SUGGEST', valueTiyin: v, note: null, userId } });
          created++;
        } else if (row.status === 'DRAFT') {
          if (row.suggestedTiyin !== v) {
            await this.prisma.kpiTarget.update({ where: { id: row.id }, data: { suggestedTiyin: v, suggestBasis: basis, updatedById: userId } });
            await this.prisma.kpiTargetLog.create({ data: { targetId: row.id, action: 'SUGGEST', valueTiyin: v, note: 'Qayta hisoblandi', userId } });
            updated++;
          }
        } else skipped++;
      }
    }
    await this.audit.log({ userId, action: 'UPDATE', entity: 'kpi_target', entityId: period, summary: `KPI takliflari ${monthName(period)}: ${created} yangi, ${updated} yangilandi` });
    return { created, updated, skipped };
  }

  private async row(id: string) {
    const row = await this.prisma.kpiTarget.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('KPI topilmadi');
    return row;
  }

  private needNote(note: string | null | undefined, why: string): string {
    const n = String(note ?? '').trim();
    if (n.length < 5) throw new BadRequestException(why);
    return n.slice(0, 500);
  }

  async propose(id: string, input: { valueTiyin?: unknown; note?: string | null }, userId: string) {
    const row = await this.row(id);
    if (row.status === 'APPROVED') throw new BadRequestException('Tasdiqlangan KPI — avval qayta oching');
    const v = parseSigned(input.valueTiyin, 'Qiymat');
    const dev = row.suggestedTiyin !== 0n ? Math.abs(Number(v - row.suggestedTiyin) / Number(row.suggestedTiyin)) : v !== 0n ? 1 : 0;
    const note = dev > 0.05 ? this.needNote(input.note, "Model taklifidan 5% dan ko'p farq — sababini izohda yozing") : String(input.note ?? '').trim().slice(0, 500) || null;
    await this.prisma.kpiTarget.update({ where: { id }, data: { proposedTiyin: v, status: 'PROPOSED', note, updatedById: userId } });
    await this.prisma.kpiTargetLog.create({ data: { targetId: id, action: 'PROPOSE', valueTiyin: v, note, userId } });
    return { ok: true };
  }

  async approve(id: string, input: { valueTiyin?: unknown; note?: string | null }, userId: string) {
    const row = await this.row(id);
    if (row.status === 'APPROVED') throw new BadRequestException('Allaqachon tasdiqlangan');
    const baseValue = row.proposedTiyin ?? row.suggestedTiyin;
    const v = input.valueTiyin === undefined || input.valueTiyin === null || input.valueTiyin === '' ? baseValue : parseSigned(input.valueTiyin, 'Qiymat');
    const note = v !== baseValue ? this.needNote(input.note, "Taklif etilgan qiymat o'zgartirildi — sababini izohda yozing") : String(input.note ?? '').trim().slice(0, 500) || null;
    await this.prisma.kpiTarget.update({ where: { id }, data: { approvedTiyin: v, status: 'APPROVED', approvedById: userId, approvedAt: new Date(), updatedById: userId, ...(note ? { note } : {}) } });
    await this.prisma.kpiTargetLog.create({ data: { targetId: id, action: 'APPROVE', valueTiyin: v, note, userId } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'kpi_target', entityId: id, summary: `KPI tasdiqlandi: ${row.period}, hudud ${row.regionCode}, ${row.metric}` });
    return { ok: true };
  }

  async reject(id: string, noteRaw: string | null | undefined, userId: string) {
    const row = await this.row(id);
    if (row.status !== 'PROPOSED') throw new BadRequestException('Faqat taklif etilgan KPI rad etiladi');
    const note = this.needNote(noteRaw, 'Rad etish sababini yozing');
    await this.prisma.kpiTarget.update({ where: { id }, data: { status: 'DRAFT', note, updatedById: userId } });
    await this.prisma.kpiTargetLog.create({ data: { targetId: id, action: 'REJECT', valueTiyin: row.proposedTiyin, note, userId } });
    return { ok: true };
  }

  async reopen(id: string, noteRaw: string | null | undefined, userId: string) {
    const row = await this.row(id);
    if (row.status !== 'APPROVED') throw new BadRequestException('Faqat tasdiqlangan KPI qayta ochiladi');
    const note = this.needNote(noteRaw, 'Qayta ochish sababini yozing');
    await this.prisma.kpiTarget.update({ where: { id }, data: { status: 'PROPOSED', proposedTiyin: row.approvedTiyin, approvedTiyin: null, approvedById: null, approvedAt: null, note, updatedById: userId } });
    await this.prisma.kpiTargetLog.create({ data: { targetId: id, action: 'REOPEN', valueTiyin: row.approvedTiyin, note, userId } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'kpi_target', entityId: id, summary: `KPI qayta ochildi: ${row.period}, hudud ${row.regionCode}, ${row.metric} — ${note}` });
    return { ok: true };
  }

  /** Oydagi barcha taklif etilganlarni tasdiqlash */
  async approveAll(periodRaw: string, userId: string) {
    const period = assertPeriod(periodRaw);
    const rows = await this.prisma.kpiTarget.findMany({ where: { period, status: 'PROPOSED' } });
    for (const r of rows) await this.approve(r.id, {}, userId);
    return { approved: rows.length };
  }

  async history(id: string) {
    await this.row(id);
    const logs = await this.prisma.kpiTargetLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'desc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.userId))] } }, select: { id: true, fullName: true } });
    const uname = new Map(users.map((u) => [u.id, u.fullName]));
    return logs.map((l) => ({ id: l.id, action: l.action, actionLabel: ACTION_LABELS[l.action] ?? l.action, valueTiyin: l.valueTiyin === null ? null : T(l.valueTiyin), note: l.note, by: uname.get(l.userId) ?? null, at: l.createdAt }));
  }
}