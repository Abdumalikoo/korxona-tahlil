import { Injectable } from '@nestjs/common';
import { EfficiencyService } from '../econ/econ.efficiency';
import { ScenarioService } from '../econ/econ.scenario';
import { EconService } from '../econ/econ.service';
import { PrismaService } from '../prisma/prisma.service';
import { byExpenseGroup, byUnit, emptySum, mln, sumBy } from './report.common';
import { dayStart, daysIn, isoOf, monthsOf, previousRange, rangeText, ReportData, todayIso, yearAgoRange, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodLabel, periodShort, safeFile, signedSom } from './reports.format';
import type { Cell, ReportDoc, ReportParams, ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Hudud pasporti: bitta hudud (yoki Markaz) bo'yicha hammasi —
// ko'rsatkichlar, boshqa hududlar orasidagi o'rni, oylar, tarkib, xodimlar,
// prognoz, samaradorlik, zararsizlik, risk, munosabat va nazorat.
// ═══════════════════════════════════════════════════════════

const DAY = 86_400_000;

@Injectable()
export class PassportReport {
  constructor(
    private readonly data: ReportData,
    private readonly prisma: PrismaService,
    private readonly econ: EconService,
    private readonly efficiency: EfficiencyService,
    private readonly scenarios: ScenarioService,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const year = yearAgoRange(range);
    const labels = await this.data.labels();
    const unit = this.data.checkUnit(params.unit, labels, true);
    const name = labels.units.get(unit)!;
    const isCenter = unit === 'center';

    const { incomes, expenses } = await this.data.rows([range, prev, year]);
    const f = ReportData.inRange(range);
    const fp = ReportData.inRange(prev);
    const fy = ReportData.inRange(year);
    const allCur = byUnit(incomes.filter(f), expenses.filter(f));
    const C = allCur.get(unit) ?? emptySum();
    const P = byUnit(incomes.filter(fp), expenses.filter(fp)).get(unit) ?? emptySum();
    const Y = byUnit(incomes.filter(fy), expenses.filter(fy)).get(unit) ?? emptySum();
    const own = (rows: typeof incomes) => rows.filter((r) => r.unit === unit);
    const curInc = own(incomes.filter(f));
    const curExp = own(expenses.filter(f));
    const prevInc = own(incomes.filter(fp));
    const prevExp = own(expenses.filter(fp));
    const [heads, headsPrev, headsYear] = await Promise.all([this.data.headcount(range, unit), this.data.headcount(prev, unit), this.data.headcount(year, unit)]);
    const R = C.income - C.expense;
    const margin = C.income > 0 ? (R / C.income) * 100 : null;
    const sections: ReportSection[] = [];

    // ─────────── 1. Asosiy ko'rsatkichlar ───────────
    const tone = (v: number | null, up: boolean) => (v === null || Math.abs(v) < 0.5 ? 'neutral' : (v > 0) === up ? 'good' : 'bad') as 'good' | 'bad' | 'neutral';
    const compare: [string, number, number, number, 'up' | 'down'][] = [
      ['Daromad', C.income, P.income, Y.income, 'up'],
      ['Xarajat', C.expense, P.expense, Y.expense, 'down'],
      ['  shundan ish haqi', C.payroll, P.payroll, Y.payroll, 'down'],
      ['  shundan ijara', C.lease, P.lease, Y.lease, 'down'],
      ['  shundan mashinalar', C.vehicle, P.vehicle, Y.vehicle, 'down'],
      ['  shundan qolganlari', C.other, P.other, Y.other, 'down'],
      ['Natija', R, P.income - P.expense, Y.income - Y.expense, 'up'],
      ['Xodimlar soni', heads, headsPrev, headsYear, 'up'],
    ];
    sections.push({
      title: "Asosiy ko'rsatkichlar",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}) va o'tgan yilning shu davri (${rangeText(year)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Daromad', value: fmtSom(C.income), sub: `o'tgan teng davrga ${fmtSignedPct(change(C.income, P.income))}`, tone: tone(change(C.income, P.income), true) },
            { label: 'Xarajat', value: fmtSom(C.expense), sub: `o'tgan teng davrga ${fmtSignedPct(change(C.expense, P.expense))}`, tone: tone(change(C.expense, P.expense), false) },
            { label: R >= 0 ? 'Foyda' : 'Zarar', value: fmtSom(R), sub: margin !== null ? `rentabellik ${fmtPct(margin)}` : undefined, tone: R >= 0 ? 'good' : 'bad' },
            { label: 'Xodimlar', value: String(heads), sub: heads > 0 ? `1 xodimga daromad ${fmtSom(C.income / heads)}` : undefined },
          ],
        },
        {
          type: 'table',
          title: 'Davrlar solishtirmasi',
          columns: [
            { label: "Ko'rsatkich", width: 2 },
            { label: 'Shu davr', format: 'money' },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'row', width: 0.8 },
            { label: "O'tgan yil shu davri", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'row', width: 0.8 },
          ],
          rows: compare.map(([l, a, b, c]) => [l, a, b, change(a, b), c, change(a, c)] as Cell[]),
          rowTone: compare.map((x) => x[4]),
        },
      ],
    });

    // ─────────── 2. Hududlar orasidagi o'rni ───────────
    const regionKeys = [...allCur.keys()].filter((k) => k.startsWith('r:'));
    if (!isCenter && regionKeys.length >= 2) {
      const headsAll = await this.data.headcountByUnit(range);
      const metric = (k: string) => {
        const u = allCur.get(k) ?? emptySum();
        const h = headsAll.get(k) ?? 0;
        return {
          income: u.income,
          result: u.income - u.expense,
          margin: u.income > 0 ? ((u.income - u.expense) / u.income) * 100 : -Infinity,
          // Xodimi yo'q hudud bir xodimga ko'rsatkichlarda qatnashmaydi (o'rtachani buzmasligi uchun)
          perHead: h > 0 ? u.income / h : NaN,
          costPerHead: h > 0 ? u.expense / h : NaN,
          payrollShare: u.expense > 0 ? (u.payroll / u.expense) * 100 : 0,
        };
      };
      const all = regionKeys.map((k) => ({ k, m: metric(k) }));
      const mine = metric(unit);
      const rank = (key: keyof typeof mine, higher: boolean) =>
        Number.isFinite(mine[key]) ? `${1 + all.filter((x) => (higher ? x.m[key] > mine[key] : x.m[key] < mine[key])).length} / ${all.filter((x) => Number.isFinite(x.m[key])).length}` : '—';
      const avg = (key: keyof typeof mine) => {
        const vals = all.map((x) => x.m[key]).filter((v) => Number.isFinite(v));
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      };
      const rows: Cell[][] = [
        ['Daromad', mine.income, rank('income', true), avg('income')],
        ['Natija', mine.result, rank('result', true), avg('result')],
        ['Bir xodimga daromad', Number.isFinite(mine.perHead) ? mine.perHead : null, rank('perHead', true), avg('perHead')],
        ['Bir xodimga xarajat', Number.isFinite(mine.costPerHead) ? mine.costPerHead : null, rank('costPerHead', false), avg('costPerHead')],
      ];
      sections.push({
        title: "Hududlar orasidagi o'rni",
        intro: '1 — eng yaxshi (xarajat uchun — eng kami). O\'rtacha — barcha hududlar bo\'yicha.',
        blocks: [
          {
            type: 'table',
            columns: [
              { label: "Ko'rsatkich", width: 2 },
              { label: name, format: 'money' },
              { label: "O'rni", width: 0.7 },
              { label: "Hududlar o'rtachasi", format: 'money' },
            ],
            rows,
          },
          {
            type: 'notes',
            items: [
              `Rentabellik: ${fmtPct(Number.isFinite(mine.margin) ? mine.margin : null)} — o'rni ${rank('margin', true)}.`,
              `Ish haqi xarajatning ${fmtPct(mine.payrollShare)} i (hududlar o'rtachasi ${fmtPct(avg('payrollShare'))}).`,
            ],
          },
        ],
      });
    }

    // ─────────── 3. Oylar bo'yicha ───────────
    const months = monthsOf(range);
    const incM = sumBy(curInc, (r) => r.month);
    const expM = sumBy(curExp, (r) => r.month);
    sections.push({
      title: "Oylar bo'yicha",
      blocks: [
        {
          type: 'chart',
          title: 'Daromad, xarajat va natija',
          kind: 'bar',
          unit: "mln so'm",
          labels: months.map(periodShort),
          series: [
            { name: 'Daromad', values: months.map((m) => mln(incM.get(m) ?? 0)), color: PALETTE.green },
            { name: 'Xarajat', values: months.map((m) => mln(expM.get(m) ?? 0)), color: PALETTE.expenseBar },
            { name: 'Natija', values: months.map((m) => mln((incM.get(m) ?? 0) - (expM.get(m) ?? 0))), color: PALETTE.navy, asLine: true },
          ],
        },
        {
          type: 'table',
          columns: [
            { label: 'Oy', width: 1.4 },
            { label: 'Daromad', format: 'money' },
            { label: 'Xarajat', format: 'money' },
            { label: 'Natija', format: 'money', toneBy: 'up' },
            { label: 'Rentabellik', format: 'pct', width: 0.8 },
          ],
          rows: months.map((m) => {
            const i = incM.get(m) ?? 0;
            const e = expM.get(m) ?? 0;
            return [periodLabel(m), i, e, i - e, i > 0 ? ((i - e) / i) * 100 : null];
          }),
          total: ['Jami', C.income, C.expense, R, margin],
        },
      ],
    });

    // ─────────── 4. Daromad va xarajat tarkibi ───────────
    const incCat = sumBy(curInc, (r) => r.categoryCode);
    const incPrev = sumBy(prevInc, (r) => r.categoryCode);
    const incSorted = [...incCat.entries()].sort((a, b) => b[1] - a[1]);
    const grp = [...byExpenseGroup(curExp, labels).entries()].sort((a, b) => b[1].amount - a[1].amount);
    const grpPrev = byExpenseGroup(prevExp, labels);
    const blocks: ReportSection['blocks'] = [];
    if (incSorted.length) {
      blocks.push({
        type: 'table',
        title: 'Daromad — xizmat turlari',
        columns: [
          { label: 'Xizmat turi', width: 2.4 },
          { label: 'Summa', format: 'money' },
          { label: 'Ulush', format: 'pct', width: 0.7 },
          { label: "O'tgan teng davr", format: 'money' },
          { label: "O'zgarish", format: 'signedPct', toneBy: 'up', width: 0.8 },
        ],
        rows: [
          ...incSorted.map(([c, v]) => [labels.incomeCategory.get(c) ?? c, v, C.income > 0 ? (v / C.income) * 100 : null, incPrev.get(c) ?? 0, change(v, incPrev.get(c) ?? 0)] as Cell[]),
          ...[...incPrev.entries()].filter(([c]) => !incCat.has(c)).map(([c, v]) => [labels.incomeCategory.get(c) ?? c, 0, 0, v, change(0, v)] as Cell[]),
        ],
        total: ['Jami', C.income, 100, P.income, change(C.income, P.income)],
      });
    }
    blocks.push({
      type: 'table',
      title: 'Xarajat — guruhlar',
      columns: [
        { label: 'Guruh', width: 2.4 },
        { label: 'Summa', format: 'money' },
        { label: 'Ulush', format: 'pct', width: 0.7 },
        { label: "O'tgan teng davr", format: 'money' },
        { label: "O'zgarish", format: 'signedPct', toneBy: 'down', width: 0.8 },
      ],
      rows: [
        ...grp.map(([k, g]) => [g.label, g.amount, C.expense > 0 ? (g.amount / C.expense) * 100 : null, grpPrev.get(k)?.amount ?? 0, change(g.amount, grpPrev.get(k)?.amount ?? 0)] as Cell[]),
        ...[...grpPrev.entries()].filter(([k]) => !grp.some(([g]) => g === k)).map(([, g]) => [g.label, 0, 0, g.amount, change(0, g.amount)] as Cell[]),
      ],
      total: ['Jami', C.expense, 100, P.expense, change(C.expense, P.expense)],
    });
    sections.push({ title: 'Daromad va xarajat tarkibi', intro: "O'zgarish — o'tgan teng davrga nisbatan.", blocks });

    // ─────────── 5. Xodimlar ───────────
    const employees = await this.prisma.employee.findMany({ select: { regionCode: true, position: true, hiredAt: true, firedAt: true, isActive: true } });
    const start = dayStart(range.from);
    const end = new Date(dayStart(range.to).getTime() + DAY);
    const code = isCenter ? 0 : Number(unit.slice(2));
    const mineEmp = employees.filter((e) => e.regionCode === code);
    const worked = mineEmp.filter((e) => (e.isActive || e.firedAt !== null) && (!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start));
    const hired = mineEmp.filter((e) => e.hiredAt && e.hiredAt >= start && e.hiredAt < end).length;
    const fired = mineEmp.filter((e) => e.firedAt && e.firedAt >= start && e.firedAt < end).length;
    const positions = new Map<string, number>();
    for (const e of worked) positions.set(e.position?.trim() || "Lavozim ko'rsatilmagan", (positions.get(e.position?.trim() || "Lavozim ko'rsatilmagan") ?? 0) + 1);
    const posSorted = [...positions.entries()].sort((a, b) => b[1] - a[1]);
    sections.push({
      title: 'Xodimlar',
      intro: "Xodimlar bo'limidan: davrda ishlagan xodimlar.",
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Davrda ishlagan', value: String(worked.length) },
            { label: 'Ishga kirgan', value: String(hired), tone: hired > 0 ? 'good' : 'neutral' },
            { label: "Bo'shagan", value: String(fired), tone: fired > 0 ? 'warn' : 'neutral' },
            { label: '1 xodimga ish haqi', value: worked.length ? fmtSom(C.payroll / worked.length) : '—', sub: 'davr jamida' },
          ],
        },
        {
          type: 'table',
          title: 'Lavozimlar',
          columns: [
            { label: 'Lavozim', width: 3 },
            { label: 'Soni', format: 'int', width: 0.7 },
            { label: 'Ulush', format: 'pct', width: 0.7 },
          ],
          rows: posSorted.slice(0, 20).map(([p, n]) => [p, n, worked.length ? (n / worked.length) * 100 : null]),
          note: posSorted.length > 20 ? `Yana ${posSorted.length - 20} ta lavozim.` : undefined,
        },
      ],
    });

    // ─────────── 6. Prognoz, samaradorlik, risk (Katta modellar) ───────────
    const modelNotes: string[] = [];
    const modelBlocks: ReportSection['blocks'] = [];
    try {
      const [fInc, fExp, fRes] = await Promise.all([
        this.econ.forecast({ target: 'income', unit, horizon: '6' }),
        this.econ.forecast({ target: 'expense', unit, horizon: '6' }),
        this.econ.forecast({ target: 'result', unit, horizon: '6' }),
      ]);
      if (fInc.forecast.length) {
        modelBlocks.push({
          type: 'table',
          title: 'Prognoz (keyingi oylar)',
          columns: [
            { label: 'Oy', width: 1.4 },
            { label: 'Daromad', format: 'money' },
            { label: 'Daromad 80% oraliq', width: 1.8 },
            { label: 'Xarajat', format: 'money' },
            { label: 'Natija', format: 'money', toneBy: 'up' },
          ],
          rows: fInc.forecast.map((p, i) => [
            periodLabel(p.period),
            Number(p.meanTiyin) / 100,
            `${fmtSom(Number(p.lo80Tiyin) / 100, false)} – ${fmtSom(Number(p.hi80Tiyin) / 100, false)}`,
            fExp.forecast[i] ? Number(fExp.forecast[i]!.meanTiyin) / 100 : null,
            fRes.forecast[i] ? Number(fRes.forecast[i]!.meanTiyin) / 100 : null,
          ]),
          note: `Natija = daromad − xarajat. Joriy oy — kamida hozirgacha yozilgan summa. Daromad modeli: ${fInc.model.name}; ishonchlilik: ${fInc.reliabilityText}.`,
        });
        modelNotes.push(...fInc.notes.slice(0, 2));
      }
    } catch {
      /* prognoz uchun ma'lumot yetarli emas */
    }
    if (!isCenter) {
      try {
        const [eff, be, risk] = await Promise.all([
          this.efficiency.efficiency({ months: '12', mode: 'resources' }),
          this.efficiency.breakeven({ months: '12' }),
          this.scenarios.risk({ horizon: '3' }),
        ]);
        const e = eff.units.find((u) => u.key === unit);
        if (e) {
          modelNotes.push(
            `Samaradorlik (DEA, 12 oy): ${fmtPct(e.crs * 100, 0)} — ${e.rank}-o'rin (${eff.units.length} tadan)` +
              (e.peers.length ? `; namuna hududlar: ${e.peers.map((p) => p.name).join(', ')}, ular kabi ishlaganda oyiga ${signedSom(Number(e.gapTiyin) / 100)} qo'shimcha daromad.` : '; samaradorlik chegarasida — boshqalar uchun namuna.'),
          );
        }
        const b = be.units.find((u) => u.key === unit);
        if (b && b.status !== 'na') modelNotes.push(`Zararsizlik: ${b.text}`);
        const k = risk.units.find((u) => u.key === unit);
        if (k) {
          modelNotes.push(
            `Risk (keyingi 3 oy): kutilayotgan natija ${fmtSom(Number(k.expectedResultTiyin) / 100)}, zarar ehtimoli ${fmtPct(k.lossProbability * 100, 0)}, kamida bir oy zarar ehtimoli ${fmtPct(k.anyMonthLossProbability * 100, 0)}.`,
          );
        }
      } catch {
        /* modellar uchun ma'lumot yetarli emas */
      }
    }
    if (modelBlocks.length || modelNotes.length) {
      sections.push({ title: 'Prognoz, samaradorlik va risk', intro: 'Katta modellar natijalari (tugagan oylar asosida).', blocks: [...modelBlocks, ...(modelNotes.length ? [{ type: 'notes' as const, items: modelNotes }] : [])] });
    }

    // ─────────── 7. Munosabat va nazorat ───────────
    const [reactions, controls] = await Promise.all([
      this.prisma.reaction.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.controlRule.findMany({ where: { isActive: true } }),
    ]);
    const touches = (filter: unknown) => (filter as { unit?: string } | null)?.unit === unit;
    const myReactions = reactions.filter((r) => r.items.some((i) => touches(i.filter)));
    const myControls = controls.filter((c) => touches(c.filter));
    if (myReactions.length || myControls.length) {
      const status = { OPEN: 'Kuzatilmoqda', CLOSED: 'Yopilgan', CONTROL: 'Nazoratda' } as const;
      // Muddat o'tgan — bugungi sana (Toshkent) muddat kunidan keyin bo'lsa (Munosabat bo'limi bilan bir xil)
      const today = todayIso();
      sections.push({
        title: 'Munosabat va nazorat',
        intro: `Shu hududga tegishli moddalar: ${myReactions.length} ta munosabat, ${myControls.length} ta faol nazorat.`,
        blocks: [
          ...(myReactions.length
            ? [
                {
                  type: 'table' as const,
                  title: 'Munosabatlar',
                  columns: [{ label: 'Nomi', width: 2.6 }, { label: 'Holati' }, { label: 'Muddat' }, { label: 'Moddalar', format: 'int' as const, width: 0.6 }],
                  rows: myReactions.slice(0, 20).map((r) => [
                    r.title,
                    `${status[r.status]}${r.status === 'OPEN' && isoOf(r.dueDate) < today ? ' (muddat o\'tgan)' : ''}`,
                    new Date(r.dueDate.getTime() + 5 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('.'),
                    r.items.filter((i) => touches(i.filter)).length,
                  ]),
                },
              ]
            : []),
          ...(myControls.length
            ? [
                {
                  type: 'table' as const,
                  title: 'Nazoratdagi moddalar',
                  columns: [{ label: 'Modda', width: 2.6 }, { label: 'Turi' }, { label: 'Oylik chegara', format: 'money' as const }],
                  rows: myControls.map((c) => [c.label, c.kind === 'EXPENSE' ? 'Xarajat (≤)' : c.kind === 'INCOME' ? 'Daromad (≥)' : 'Natija (≥)', Number(c.limitTiyin) / 100]),
                },
              ]
            : []),
        ],
      });
    }

    // ─────────── 8. Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${name}, ${rangeText(range)}: daromad ${fmtSom(C.income)}, xarajat ${fmtSom(C.expense)}, ${R >= 0 ? 'foyda' : 'zarar'} ${fmtSom(Math.abs(R))}${margin !== null ? ` (rentabellik ${fmtPct(margin)})` : ''}.`);
    if (P.income || P.expense) {
      notes.push(`O'tgan teng davrga nisbatan: daromad ${fmtSignedPct(change(C.income, P.income))}, xarajat ${fmtSignedPct(change(C.expense, P.expense))}, natija ${signedSom(R - (P.income - P.expense))}.`);
    }
    if (incSorted[0]) notes.push(`Asosiy daromad manbai — ${labels.incomeCategory.get(incSorted[0][0]) ?? incSorted[0][0]} (${fmtPct(C.income > 0 ? (incSorted[0][1] / C.income) * 100 : null)}).`);
    if (grp[0]) notes.push(`Eng katta xarajat — ${grp[0][1].label} (${fmtPct(C.expense > 0 ? (grp[0][1].amount / C.expense) * 100 : null)}).`);
    if (heads > 0) notes.push(`Davrda ${heads} nafar xodim ishlagan (${hired} kirgan, ${fired} bo'shagan); bir xodimga daromad ${fmtSom(C.income / heads)}.`);
    if (isCenter) notes.push("Markazning o'z daromadi kam yoki yo'q — uning xarajati hududlar foydasidan qoplanadi.");
    notes.push(...modelNotes.slice(-3));
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Hudud pasporti',
      title: `${name}: hudud pasporti`,
      subtitle: `${name} · ${rangeText(range)}`,
      meta: [
        `Davr: ${rangeText(range)} (${daysIn(range)} kun)`,
        `Solishtirish: o'tgan teng davr ${rangeText(prev)}; o'tgan yil ${rangeText(year)}`,
        "Manba: Daromadlar, Xarajatlar va Xodimlar bo'limlari; Katta modellar, Munosabat va Nazorat",
      ],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Hudud pasporti - ${name} - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}