import { Injectable } from '@nestjs/common';
import { loadPolicyRouting } from '../expense-policy/policy.util';
import { Prisma } from '@prisma/client';
import { EconData } from '../econ/econ.data';
import { EconService } from '../econ/econ.service';
import { PrismaService } from '../prisma/prisma.service';
import { ControlsService } from '../reactions/controls.service';
import { ReactionMetrics } from '../reactions/reactions.metrics';
import { SectionsService } from '../sections/sections.service';
import { RegionsService } from '../structure/regions.service';
import { StructureService } from '../structure/structure.service';
import { dayStart, monthsOf, rangeText, ReportData, unitKeyOf, type Range } from './reports.data';
import { periodLabel } from './reports.format';

// ═══════════════════════════════════════════════════════════
// Raqamlar tekshiruvi (haqiqiy bazada): har bir bo'lim hisoblagan raqam
// bazadan to'g'ridan-to'g'ri SQL bilan olingan qiymat bilan solishtiriladi (tiyingacha).
// Mustaqil asos: o'chirilmagan yozuvlar, sana (Toshkent vaqti) bo'yicha.
// ═══════════════════════════════════════════════════════════

const TZ = 5 * 3600_000;

export interface ReconcileCheck {
  area: string;
  name: string;
  /** Bazadan (SQL) — tiyin */
  expectedTiyin: string | null;
  /** Bo'lim hisoblagani — tiyin */
  actualTiyin: string | null;
  ok: boolean;
  detail?: string;
}

export interface ReconcileResult {
  range: Range;
  rangeText: string;
  checkedAt: string;
  /** Brauzerda ro'yxatlar (bosh sahifa) bilan solishtirish uchun asos */
  baseline: {
    incomeTiyin: string;
    expenseTiyin: string;
    incomeDoimiyTiyin: string;
    expenseDoimiyTiyin: string;
    /** To'lanmagan qism (hisobotlar qoidasi): UNPAID — butun summa, PARTIAL — summa − to'langan */
    receivableTiyin: string;
  };
  checks: ReconcileCheck[];
  passed: number;
  failed: number;
}

interface SumRow {
  month?: string;
  regionCode?: number | null;
  departmentId?: string | null;
  section?: string;
  source?: string | null;
  categoryCode?: string | null;
  segment?: string | null;
  total: bigint | string | number | null;
}

const big = (v: bigint | string | number | null | undefined) => BigInt(v ?? 0);

function monthBounds(period: string): { gte: Date; lt: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1) - TZ), lt: new Date(Date.UTC(y, m, 1) - TZ) };
}

@Injectable()
export class ReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly data: ReportData,
    private readonly econData: EconData,
    private readonly econ: EconService,
    private readonly structure: StructureService,
    private readonly regions: RegionsService,
    private readonly sections: SectionsService,
    private readonly controls: ControlsService,
    private readonly metrics: ReactionMetrics,
  ) {}

  /** Davr (sana) bo'yicha SQL yig'indilari: oy × hudud × bo'lim × manba */
  private async sql(table: 'incomes' | 'expenses', start: Date, end: Date): Promise<SumRow[]> {
    const t = Prisma.raw(`"${table}"`);
    const source = table === 'expenses' ? Prisma.sql`"source"::text` : Prisma.sql`NULL::text`;
    const category = table === 'expenses' ? Prisma.sql`"categoryCode"` : Prisma.sql`NULL::text`;
    return this.prisma.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT to_char("date" + interval '5 hours', 'YYYY-MM') AS month, "regionCode", "departmentId", "section"::text AS section,
             ${source} AS source, ${category} AS "categoryCode", "segment", SUM("amountTiyin")::bigint AS total
      FROM ${t}
      WHERE "deletedAt" IS NULL AND "date" >= ${start} AND "date" < ${end}
      GROUP BY 1, 2, 3, 4, 5, 6, 7`);
  }

  async run(from?: string, to?: string): Promise<ReconcileResult> {
    const range = this.data.parseRange(from, to);
    const start = dayStart(range.from);
    const end = new Date(dayStart(range.to).getTime() + 86_400_000);
    const checks: ReconcileCheck[] = [];
    const add = (area: string, name: string, expected: bigint | null, actual: bigint | null, detail?: string) =>
      checks.push({ area, name, expectedTiyin: expected === null ? null : expected.toString(), actualTiyin: actual === null ? null : actual.toString(), ok: expected === actual, ...(detail ? { detail } : {}) });
    const safe = async (area: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        checks.push({ area, name: 'Hisoblashda xato', expectedTiyin: null, actualTiyin: null, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    };

    // ─────────── Asos: to'g'ridan-to'g'ri SQL ───────────
    const [incRows, expRows] = await Promise.all([this.sql('incomes', start, end), this.sql('expenses', start, end)]);
    const sum = (rows: SumRow[], pred: (r: SumRow) => boolean = () => true) => rows.filter(pred).reduce((s, r) => s + big(r.total), 0n);
    // Xarajatlar siyosati: Markaz hisobidagi moddalar (bayram, choraklik, asosiy vositalar sarfi …) — Markazga
    const routing = await loadPolicyRouting(this.prisma).catch(() => ({ moved: new Set<string>(), payerKey: () => 'center' }));
    const isCenterCat = (r: SumRow) => Boolean(r.categoryCode && routing.moved.has(r.categoryCode));
    const unitOf = (r: SumRow) => (isCenterCat(r) ? routing.payerKey(r.categoryCode!) : unitKeyOf(r.regionCode ?? null, r.departmentId ?? null, r.segment ?? null));
    const I = sum(incRows);
    const E = sum(expRows);
    const units = [...new Set([...incRows, ...expRows].map(unitOf))];
    const labels = await this.data.labels();
    const uname = (k: string) => labels.units.get(k) ?? k;
    const receivable = await this.prisma.$queryRaw<{ total: bigint | string | null }[]>(Prisma.sql`
      SELECT SUM(CASE WHEN "paymentStatus"::text = 'UNPAID' THEN "amountTiyin"
                      WHEN "paymentStatus"::text = 'PARTIAL' THEN GREATEST("amountTiyin" - "paidTiyin", 0)
                      ELSE 0 END)::bigint AS total
      FROM "incomes" WHERE "deletedAt" IS NULL AND "date" >= ${start} AND "date" < ${end}`);

    // ─────────── 1. Hisobotlar ───────────
    await safe('Hisobotlar', async () => {
      const { incomes, expenses } = await this.data.rows([range]);
      const t = (rows: { amount: number }[]) => BigInt(Math.round(rows.reduce((s, r) => s + r.amount * 100, 0)));
      add('Hisobotlar', 'Daromad (jami)', I, t(incomes));
      add('Hisobotlar', 'Xarajat (jami)', E, t(expenses));
      add('Hisobotlar', "Ish haqi (Xarajatlardan)", sum(expRows, (r) => r.source === 'PAYROLL'), t(expenses.filter((r) => r.source === 'PAYROLL')));
      for (const u of units) {
        add('Hisobotlar', `Daromad — ${uname(u)}`, sum(incRows, (r) => unitOf(r) === u), t(incomes.filter((r) => r.unit === u)));
        add('Hisobotlar', `Xarajat — ${uname(u)}`, sum(expRows, (r) => unitOf(r) === u), t(expenses.filter((r) => r.unit === u)));
      }
    });

    // ─────────── 2. Tahlil ───────────
    await safe('Tahlil', async () => {
      const [ti, te, flow] = await Promise.all([
        this.structure.tree('income', { from: range.from, to: range.to } as never),
        this.structure.tree('expense', { from: range.from, to: range.to } as never),
        this.structure.flow({ from: range.from, to: range.to } as never),
      ]);
      add('Tahlil', 'Daromad daraxti (jami)', I, big(ti.totalTiyin));
      add('Tahlil', 'Xarajat daraxti (jami)', E, big(te.totalTiyin));
      add('Tahlil', 'Umumiy oqim: daromad', I, big(flow.income.totalTiyin));
      add('Tahlil', 'Umumiy oqim: xarajat', E, big(flow.expense.totalTiyin));
      add('Tahlil', 'Umumiy oqim: natija', I - E, big(flow.profitTiyin));
      add('Tahlil', 'Daromad: Doimiy', sum(incRows, (r) => r.section === 'DOIMIY'), big(flow.split.income.doimiyTiyin));
      add('Tahlil', 'Daromad: Boshqa', sum(incRows, (r) => r.section === 'BOSHQA'), big(flow.split.income.boshqaTiyin));
      add('Tahlil', 'Xarajat: Doimiy', sum(expRows, (r) => r.section === 'DOIMIY'), big(flow.split.expense.doimiyTiyin));
      add('Tahlil', 'Xarajat: Boshqa', sum(expRows, (r) => r.section === 'BOSHQA'), big(flow.split.expense.boshqaTiyin));
      // Oylar dinamikasi: davr ichidagi to'liq oylar
      const full = monthsOf(range).filter((m) => monthBounds(m).gte >= start && monthBounds(m).lt <= end);
      if (full.length) {
        const [mi, me] = await Promise.all([this.sql('incomes', monthBounds(full[0]!).gte, monthBounds(full[full.length - 1]!).lt), this.sql('expenses', monthBounds(full[0]!).gte, monthBounds(full[full.length - 1]!).lt)]);
        for (const m of full) {
          const i = ti.months.indexOf(m);
          if (i >= 0) add('Tahlil', `Daromad dinamikasi — ${periodLabel(m)}`, sum(mi, (r) => r.month === m), big(ti.totalTrend[i]));
          const j = te.months.indexOf(m);
          if (j >= 0) add('Tahlil', `Xarajat dinamikasi — ${periodLabel(m)}`, sum(me, (r) => r.month === m), big(te.totalTrend[j]));
        }
      }
    });

    // ─────────── 3. Solishtirma ───────────
    await safe('Solishtirma', async () => {
      const res = await this.regions.compare({ from: range.from, to: range.to } as never);
      const heads = await this.data.headcountByUnit(range);
      let si = 0n;
      let se = 0n;
      for (const u of res.units) {
        si += big(u.incomeTiyin);
        se += big(u.expenseTiyin);
        add('Solishtirma', `${u.name}: daromad`, sum(incRows, (r) => unitOf(r) === u.key), big(u.incomeTiyin));
        add('Solishtirma', `${u.name}: xarajat`, sum(expRows, (r) => unitOf(r) === u.key), big(u.expenseTiyin));
        add('Solishtirma', `${u.name}: ish haqi`, sum(expRows, (r) => unitOf(r) === u.key && r.source === 'PAYROLL' && !isCenterCat(r)), big(u.payrollTiyin));
        add('Solishtirma', `${u.name}: xodimlar soni`, BigInt(heads.get(u.key) ?? 0), BigInt(u.headcount), 'soni (tiyin emas)');
      }
      add('Solishtirma', 'Barcha birliklar: daromad', I, si);
      add('Solishtirma', 'Barcha birliklar: xarajat', E, se);
    });

    // ─────────── 4. Bosh sahifa: Doimiy / Boshqa dinamikasi ───────────
    await safe('Bosh sahifa', async () => {
      const months = monthsOf(range);
      const first = months[0]!;
      const last = months[months.length - 1]!;
      const [ti, te, mi, me] = await Promise.all([
        this.sections.trend('income', first, last),
        this.sections.trend('expense', first, last),
        this.sql('incomes', monthBounds(first).gte, monthBounds(last).lt),
        this.sql('expenses', monthBounds(first).gte, monthBounds(last).lt),
      ]);
      for (const [label, trend, rows] of [['Daromad', ti, mi], ['Xarajat', te, me]] as const) {
        for (const p of trend) {
          add('Bosh sahifa', `${label} ${periodLabel(p.period)}: Doimiy`, sum(rows, (r) => r.month === p.period && r.section === 'DOIMIY'), big(p.doimiyTiyin));
          add('Bosh sahifa', `${label} ${periodLabel(p.period)}: Boshqa`, sum(rows, (r) => r.month === p.period && r.section === 'BOSHQA'), big(p.boshqaTiyin));
        }
      }
    });

    // ─────────── 5. Katta modellar ───────────
    await safe('Katta modellar', async () => {
      const panel = await this.econData.panel();
      const first = panel.months[0]!;
      const [mi, me] = await Promise.all([this.sql('incomes', monthBounds(first).gte, monthBounds(panel.currentPeriod).lt), this.sql('expenses', monthBounds(first).gte, monthBounds(panel.currentPeriod).lt)]);
      const t = (v: number) => BigInt(Math.round(v * 100));
      panel.months.forEach((m, i) => {
        add('Katta modellar', `Daromad — ${periodLabel(m)}`, sum(mi, (r) => r.month === m), t(panel.total.income[i]!));
        add('Katta modellar', `Xarajat — ${periodLabel(m)}`, sum(me, (r) => r.month === m), t(panel.total.expense[i]!));
      });
      const [fi, fe, fr] = await Promise.all(['income', 'expense', 'result'].map((target) => this.econ.forecast({ target, unit: 'all', horizon: '6' })));
      const year = panel.currentPeriod.slice(0, 4);
      const actualI = sum(mi, (r) => Boolean(r.month?.startsWith(`${year}-`)) && r.month! < panel.currentPeriod);
      const actualE = sum(me, (r) => Boolean(r.month?.startsWith(`${year}-`)) && r.month! < panel.currentPeriod);
      if (fi!.yearEnd && fe!.yearEnd && fr!.yearEnd) {
        const y = (f: typeof fi) => f!.yearEnd!;
        add('Katta modellar', `${year}-yil daromadi: haqiqiy qism`, actualI, big(y(fi).actualTiyin));
        add('Katta modellar', `${year}-yil xarajati: haqiqiy qism`, actualE, big(y(fe).actualTiyin));
        add('Katta modellar', `${year}-yil daromadi: joriy oyda yozilgan`, sum(mi, (r) => r.month === panel.currentPeriod), big(y(fi).currentSoFarTiyin));
        for (const [label, f] of [['daromad', fi], ['xarajat', fe], ['natija', fr]] as const) {
          const v = y(f);
          add('Katta modellar', `${year}-yil ${label}: haqiqiy + joriy oy + prognoz = jami`, big(v.actualTiyin) + big(v.currentExpectedTiyin) + big(v.restTiyin), big(v.totalTiyin));
        }
        add('Katta modellar', `${year}-yil natijasi = daromad − xarajat`, big(y(fi).totalTiyin) - big(y(fe).totalTiyin), big(y(fr).totalTiyin));
        fr!.forecast.forEach((p, i) => add('Katta modellar', `Natija prognozi ${periodLabel(p.period)} = daromad − xarajat`, big(fi!.forecast[i]?.meanTiyin) - big(fe!.forecast[i]?.meanTiyin), big(p.meanTiyin)));
      }
    });

    // ─────────── 6. Nazorat ───────────
    await safe('Nazorat', async () => {
      const list = (await this.controls.list()).filter((c) => c.isActive);
      for (const c of list) {
        for (const m of c.months) {
          const b = monthBounds(m.period);
          const toIso = new Date(b.lt.getTime() - 86_400_000 + TZ).toISOString().slice(0, 10);
          const fromIso = new Date(b.gte.getTime() + TZ).toISOString().slice(0, 10);
          // Mustaqil yo'l: sana oralig'i bo'yicha aggregate (Nazorat — kunlar bo'yicha guruhlab)
          const direct = await this.metrics.sumDates(c.kind, c.filter, fromIso, toIso);
          add('Nazorat', `${c.label} — ${periodLabel(m.period)}`, direct, big(m.valueTiyin));
        }
      }
    });

    const failed = checks.filter((c) => !c.ok).length;
    return {
      range,
      rangeText: rangeText(range),
      checkedAt: new Date(Date.now() + TZ).toISOString(),
      baseline: {
        incomeTiyin: I.toString(),
        expenseTiyin: E.toString(),
        incomeDoimiyTiyin: sum(incRows, (r) => r.section === 'DOIMIY').toString(),
        expenseDoimiyTiyin: sum(expRows, (r) => r.section === 'DOIMIY').toString(),
        receivableTiyin: big(receivable[0]?.total).toString(),
      },
      checks,
      passed: checks.length - failed,
      failed,
    };
  }
}