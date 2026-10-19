import { Injectable } from '@nestjs/common';
import { daysIn, monthsOf, previousRange, rangeText, ReportData, yearAgoRange, type Labels, type Range, type Row } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodLabel, periodShort, safeFile, signedSom } from './reports.format';
import type { Cell, ReportDoc, ReportParams, ReportSection, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Davr moliyaviy hisoboti:
// daromad, xarajat, natija — o'tgan teng davr va o'tgan yilning shu davri bilan;
// oylar, daromad va xarajat tarkibi, hududlar, xulosalar.
// ═══════════════════════════════════════════════════════════

interface Totals {
  income: number;
  incomeDoimiy: number;
  expense: number;
  expenseDoimiy: number;
  payroll: number;
  result: number;
  margin: number | null;
}

function totals(incomes: Row[], expenses: Row[]): Totals {
  const income = incomes.reduce((s, r) => s + r.amount, 0);
  const expense = expenses.reduce((s, r) => s + r.amount, 0);
  return {
    income,
    incomeDoimiy: incomes.filter((r) => r.section === 'DOIMIY').reduce((s, r) => s + r.amount, 0),
    expense,
    expenseDoimiy: expenses.filter((r) => r.section === 'DOIMIY').reduce((s, r) => s + r.amount, 0),
    payroll: expenses.filter((r) => r.source === 'PAYROLL').reduce((s, r) => s + r.amount, 0),
    result: income - expense,
    margin: income > 0 ? ((income - expense) / income) * 100 : null,
  };
}

/** Xarajat guruhi: ish haqi, ijara, mashinalar yoki yuqori darajali modda */
export function expenseGroup(row: Row, labels: Labels): { key: string; label: string } {
  if (row.source === 'PAYROLL') return { key: 'src:PAYROLL', label: 'Ish haqi' };
  if (row.source === 'LEASE') return { key: 'src:LEASE', label: 'Ijara' };
  if (row.source === 'VEHICLE') return { key: 'src:VEHICLE', label: 'Mashinalar' };
  let code = row.categoryCode;
  for (let i = 0; i < 6; i += 1) {
    const parent = labels.expenseCategory.get(code)?.parent;
    if (!parent) break;
    code = parent;
  }
  return { key: `root:${code}`, label: labels.expenseCategory.get(code)?.label ?? code };
}

function sumBy(rows: Row[], key: (r: Row) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.amount);
  return m;
}

const mln = (v: number) => Math.round((v / 1e6) * 10) / 10;

@Injectable()
export class FinancialReport {
  constructor(private readonly data: ReportData) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const year = yearAgoRange(range);
    const labels = await this.data.labels();
    const unit = this.data.checkUnit(params.unit, labels);
    const unitName = labels.units.get(unit)!;

    const { incomes, expenses } = await this.data.rows([range, prev, year], unit);
    const pick = (r: Range) => {
      const f = ReportData.inRange(r);
      return { incomes: incomes.filter(f), expenses: expenses.filter(f) };
    };
    const cur = pick(range);
    const pr = pick(prev);
    const ya = pick(year);
    const T = totals(cur.incomes, cur.expenses);
    const P = totals(pr.incomes, pr.expenses);
    const Y = totals(ya.incomes, ya.expenses);
    const [heads, headsPrev, headsYear] = await Promise.all([this.data.headcount(range, unit), this.data.headcount(prev, unit), this.data.headcount(year, unit)]);

    const toneUp = (c: number | null): Tone => (c === null || Math.abs(c) < 0.5 ? 'neutral' : c > 0 ? 'good' : 'bad');
    const toneDown = (c: number | null): Tone => (c === null || Math.abs(c) < 0.5 ? 'neutral' : c < 0 ? 'good' : 'bad');
    const days = daysIn(range);
    const sections: ReportSection[] = [];
    const compareRows: [string, number, number, number, 'up' | 'down'][] = [
      ['Daromad', T.income, P.income, Y.income, 'up'],
      ['  shundan Doimiy', T.incomeDoimiy, P.incomeDoimiy, Y.incomeDoimiy, 'up'],
      ['  shundan Boshqa (bir martalik)', T.income - T.incomeDoimiy, P.income - P.incomeDoimiy, Y.income - Y.incomeDoimiy, 'up'],
      ['Xarajat', T.expense, P.expense, Y.expense, 'down'],
      ['  shundan Doimiy', T.expenseDoimiy, P.expenseDoimiy, Y.expenseDoimiy, 'down'],
      ['  shundan Boshqa (bir martalik)', T.expense - T.expenseDoimiy, P.expense - P.expenseDoimiy, Y.expense - Y.expenseDoimiy, 'down'],
      ['  shundan ish haqi', T.payroll, P.payroll, Y.payroll, 'down'],
      ['Natija (daromad − xarajat)', T.result, P.result, Y.result, 'up'],
      ['Xodimlar soni (davrda ishlagan)', heads, headsPrev, headsYear, 'up'],
    ];

    // ─────────── 1. Asosiy ko'rsatkichlar ───────────
    const cI = change(T.income, P.income);
    const cE = change(T.expense, P.expense);
    const dR = T.result - P.result;
    sections.push({
      title: "Asosiy ko'rsatkichlar",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}) va o'tgan yilning shu davri (${rangeText(year)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Daromad', value: fmtSom(T.income), sub: `o'tgan teng davrga ${fmtSignedPct(cI)}`, tone: toneUp(cI) },
            { label: 'Xarajat', value: fmtSom(T.expense), sub: `o'tgan teng davrga ${fmtSignedPct(cE)}`, tone: toneDown(cE) },
            { label: T.result >= 0 ? 'Foyda' : 'Zarar', value: fmtSom(T.result), sub: `o'tgan teng davrga ${signedSom(dR)}`, tone: T.result >= 0 ? 'good' : 'bad' },
            { label: 'Rentabellik', value: fmtPct(T.margin), sub: `o'tgan teng davrda ${fmtPct(P.margin)}`, tone: T.margin !== null && T.margin < 0 ? 'bad' : 'neutral' },
          ],
        },
        {
          type: 'table',
          title: 'Davrlar solishtirmasi',
          columns: [
            { label: "Ko'rsatkich", width: 2.4 },
            { label: 'Shu davr', format: 'money' },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', width: 0.8, toneBy: 'row' },
            { label: "O'tgan yil shu davri", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', width: 0.8, toneBy: 'row' },
          ],
          rows: compareRows.map(([label, a, b, c]) => [label, a, b, change(a, b), c, change(a, c)] as Cell[]),
          rowTone: compareRows.map(([, , , , dir]) => dir),
          note: "O'zgarish ustunida yashil — yaxshi (daromad o'sishi, xarajat kamayishi), qizil — yomon.",
        },
      ],
    });

    // ─────────── 2. Oylar bo'yicha ───────────
    const months = monthsOf(range);
    const incM = sumBy(cur.incomes, (r) => r.month);
    const expM = sumBy(cur.expenses, (r) => r.month);
    let cumulative = 0;
    const monthRows = months.map((m) => {
      const i = incM.get(m) ?? 0;
      const e = expM.get(m) ?? 0;
      cumulative += i - e;
      return [periodLabel(m), i, e, i - e, i > 0 ? ((i - e) / i) * 100 : null, cumulative] as Cell[];
    });
    const partialFirst = range.from.slice(8) !== '01';
    const lastDay = new Date(Date.UTC(Number(range.to.slice(0, 4)), Number(range.to.slice(5, 7)), 0)).getUTCDate();
    const partialLast = Number(range.to.slice(8)) !== lastDay;
    sections.push({
      title: "Oylar bo'yicha",
      intro: partialFirst || partialLast ? `Diqqat: ${[partialFirst ? 'birinchi' : null, partialLast ? 'oxirgi' : null].filter(Boolean).join(' va ')} oy to'liq emas — davr chegarasigacha bo'lgan yozuvlar kiritilgan.` : undefined,
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
            { label: "Yig'ma natija", format: 'money', toneBy: 'up' },
          ],
          rows: monthRows,
          total: ['Jami', T.income, T.expense, T.result, T.margin, null],
        },
      ],
    });

    // ─────────── 3. Daromad tarkibi ───────────
    const incCat = sumBy(cur.incomes, (r) => r.categoryCode);
    const incCatPrev = sumBy(pr.incomes, (r) => r.categoryCode);
    const incSorted = [...incCat.entries()].sort((a, b) => b[1] - a[1]);
    const incName = (code: string) => labels.incomeCategory.get(code) ?? code;
    sections.push({
      title: 'Daromad tarkibi',
      intro: 'Xizmat turlari bo\'yicha, eng kattasidan boshlab.',
      blocks: [
        {
          type: 'chart',
          title: 'Eng katta 10 ta xizmat turi',
          kind: 'barh',
          unit: "mln so'm",
          labels: incSorted.slice(0, 10).map(([c]) => incName(c)),
          series: [{ name: 'Daromad', values: incSorted.slice(0, 10).map(([, v]) => mln(v)), color: PALETTE.green }],
        },
        {
          type: 'table',
          columns: [
            { label: 'Xizmat turi', width: 2.6 },
            { label: 'Summa', format: 'money' },
            { label: 'Ulush', format: 'pct', width: 0.7 },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'up', width: 0.8 },
          ],
          rows: [
            ...incSorted.map(([code, v]) => [incName(code), v, T.income > 0 ? (v / T.income) * 100 : null, incCatPrev.get(code) ?? 0, change(v, incCatPrev.get(code) ?? 0)] as Cell[]),
            // O'tgan davrda bo'lib, shu davrda yo'q xizmatlar
            ...[...incCatPrev.entries()].filter(([code]) => !incCat.has(code)).map(([code, v]) => [incName(code), 0, 0, v, change(0, v)] as Cell[]),
          ],
          total: ['Jami', T.income, 100, P.income, change(T.income, P.income)],
          slideRows: 13,
        },
      ],
    });

    // ─────────── 4. Xarajat tarkibi ───────────
    const grp = (r: Row) => expenseGroup(r, labels);
    const expGrp = new Map<string, { label: string; cur: number; prev: number }>();
    for (const r of cur.expenses) {
      const g = grp(r);
      const x = expGrp.get(g.key) ?? { label: g.label, cur: 0, prev: 0 };
      x.cur += r.amount;
      expGrp.set(g.key, x);
    }
    for (const r of pr.expenses) {
      const g = grp(r);
      const x = expGrp.get(g.key) ?? { label: g.label, cur: 0, prev: 0 };
      x.prev += r.amount;
      expGrp.set(g.key, x);
    }
    const grpSorted = [...expGrp.values()].sort((a, b) => b.cur - a.cur);
    const leaf = sumBy(cur.expenses, (r) => (r.source === 'PAYROLL' || r.source === 'LEASE' || r.source === 'VEHICLE' ? `src:${r.source}` : r.categoryCode));
    const leafPrev = sumBy(pr.expenses, (r) => (r.source === 'PAYROLL' || r.source === 'LEASE' || r.source === 'VEHICLE' ? `src:${r.source}` : r.categoryCode));
    const leafName = (k: string) => (k === 'src:PAYROLL' ? 'Ish haqi' : k === 'src:LEASE' ? 'Ijara' : k === 'src:VEHICLE' ? 'Mashinalar' : labels.expenseCategory.get(k)?.label ?? k);
    const leafSorted = [...leaf.entries()].sort((a, b) => b[1] - a[1]);
    const grown = [...new Set([...leaf.keys(), ...leafPrev.keys()])]
      .map((k) => ({ k, d: (leaf.get(k) ?? 0) - (leafPrev.get(k) ?? 0) }))
      .sort((a, b) => b.d - a.d);
    sections.push({
      title: 'Xarajat tarkibi',
      intro: 'Guruhlar (ish haqi, ijara, mashinalar va asosiy moddalar) va eng katta moddalar.',
      blocks: [
        {
          type: 'chart',
          title: "Xarajat guruhlari",
          kind: 'barh',
          unit: "mln so'm",
          labels: grpSorted.slice(0, 10).map((g) => g.label),
          series: [{ name: 'Xarajat', values: grpSorted.slice(0, 10).map((g) => mln(g.cur)), color: PALETTE.expenseBar }],
        },
        {
          type: 'table',
          title: 'Guruhlar',
          columns: [
            { label: 'Guruh', width: 2.6 },
            { label: 'Summa', format: 'money' },
            { label: 'Ulush', format: 'pct', width: 0.7 },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'down', width: 0.8 },
          ],
          rows: grpSorted.map((g) => [g.label, g.cur, T.expense > 0 ? (g.cur / T.expense) * 100 : null, g.prev, change(g.cur, g.prev)]),
          total: ['Jami', T.expense, 100, P.expense, change(T.expense, P.expense)],
        },
        {
          type: 'table',
          title: 'Eng katta 15 ta modda',
          columns: [
            { label: 'Modda', width: 2.6 },
            { label: 'Summa', format: 'money' },
            { label: 'Ulush', format: 'pct', width: 0.7 },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'down', width: 0.8 },
          ],
          rows: leafSorted.slice(0, 15).map(([k, v]) => [leafName(k), v, T.expense > 0 ? (v / T.expense) * 100 : null, leafPrev.get(k) ?? 0, change(v, leafPrev.get(k) ?? 0)]),
          slideRows: 15,
        },
      ],
    });

    // ─────────── 5. Hududlar ───────────
    let regionNotes: string[] = [];
    if (unit === 'all') {
      const uI = sumBy(cur.incomes, (r) => r.unit);
      const uE = sumBy(cur.expenses, (r) => r.unit);
      const pI = sumBy(pr.incomes, (r) => r.unit);
      const pE = sumBy(pr.expenses, (r) => r.unit);
      // Shu yoki o'tgan davrda yozuvi bor birliklar (ustunlar yig'indisi jamiga teng bo'lishi uchun)
      const keys = [...new Set([...uI.keys(), ...uE.keys(), ...pI.keys(), ...pE.keys()])];
      const order = (k: string) => (k.startsWith('r:') ? 0 : k === 'center' ? 1 : 2);
      const rowsU = keys
        .map((k) => {
          const i = uI.get(k) ?? 0;
          const e = uE.get(k) ?? 0;
          const prevR = (pI.get(k) ?? 0) - (pE.get(k) ?? 0);
          return { k, name: labels.units.get(k) ?? k, i, e, r: i - e, m: i > 0 ? ((i - e) / i) * 100 : null, d: i - e - prevR };
        })
        .sort((a, b) => order(a.k) - order(b.k) || b.r - a.r);
      const regionsOnly = rowsU.filter((x) => x.k.startsWith('r:'));
      sections.push({
        title: 'Hududlar',
        intro: "Daromad — hududda bajarilgan ishlar; xarajat — hudud xarajatlari va xodimlari ish haqi. Markaz va biriktirilmagan yozuvlar alohida.",
        blocks: [
          {
            type: 'chart',
            title: 'Hududlar natijasi',
            kind: 'barh',
            unit: "mln so'm",
            labels: regionsOnly.map((x) => x.name),
            series: [{ name: 'Natija', values: regionsOnly.map((x) => mln(x.r)), color: PALETTE.navy }],
          },
          {
            type: 'table',
            columns: [
              { label: 'Hudud', width: 2 },
              { label: 'Daromad', format: 'money' },
              { label: 'Xarajat', format: 'money' },
              { label: 'Natija', format: 'money', toneBy: 'up' },
              { label: 'Rentabellik', format: 'pct', width: 0.8 },
              { label: "O'tgan davr natijasi", format: 'money' },
              { label: "Natija o'zgarishi", format: 'money', toneBy: 'up' },
            ],
            rows: rowsU.map((x) => [x.name, x.i, x.e, x.r, x.m, x.r - x.d, x.d]),
            total: ['Jami', T.income, T.expense, T.result, T.margin, P.result, T.result - P.result],
            note: "«Natija o'zgarishi» — o'tgan teng davrga nisbatan.",
          },
        ],
      });
      const losing = regionsOnly.filter((x) => x.r < 0);
      if (regionsOnly.length) {
        regionNotes = [
          `${regionsOnly.length} ta hududdan ${regionsOnly.length - losing.length} tasi foyda bilan ishladi` +
            (losing.length ? `; zararda: ${losing.map((x) => `${x.name} (${fmtSom(x.r)})`).join(', ')}.` : '.'),
          `Eng ko'p foyda — ${regionsOnly[0]!.name} (${fmtSom(regionsOnly[0]!.r)}).`,
        ];
        const center = rowsU.find((x) => x.k === 'center');
        const regionsProfit = regionsOnly.reduce((s, x) => s + x.r, 0);
        if (center && center.e - center.i > 0) {
          regionNotes.push(
            `Markaz sof xarajati (xarajat − daromad) ${fmtSom(center.e - center.i)}; hududlar jami foydasi ${fmtSom(regionsProfit)} — ${regionsProfit >= center.e - center.i ? "uni to'liq qoplaydi" : `uning ${fmtPct((regionsProfit / (center.e - center.i)) * 100, 0)} ini qoplaydi`}.`,
          );
        }
      }
    }

    // ─────────── 6. Xulosalar ───────────
    const notes: string[] = [];
    notes.push(
      `${unitName}, ${rangeText(range)} (${days} kun): daromad ${fmtSom(T.income)}, xarajat ${fmtSom(T.expense)}, ${T.result >= 0 ? 'foyda' : 'zarar'} ${fmtSom(Math.abs(T.result))}` +
        (T.margin !== null ? ` (rentabellik ${fmtPct(T.margin)}).` : '.'),
    );
    if (P.income || P.expense) {
      notes.push(
        `O'tgan teng davrga nisbatan: daromad ${fmtSignedPct(cI)}, xarajat ${fmtSignedPct(cE)}; natija ${dR >= 0 ? 'yaxshilandi' : 'yomonlashdi'} (${signedSom(dR)}).`,
      );
    }
    if (Y.income || Y.expense) {
      notes.push(
        `O'tgan yilning shu davriga nisbatan: daromad ${fmtSignedPct(change(T.income, Y.income))}, xarajat ${fmtSignedPct(change(T.expense, Y.expense))}, natija ${signedSom(T.result - Y.result)}.`,
      );
    }
    if (incSorted.length) {
      const [code, v] = incSorted[0]!;
      notes.push(`Eng katta daromad manbai — ${incName(code)}: ${fmtSom(v)} (${fmtPct(T.income > 0 ? (v / T.income) * 100 : null)}).`);
    }
    if (grpSorted.length) {
      notes.push(`Eng katta xarajat guruhi — ${grpSorted[0]!.label}: ${fmtSom(grpSorted[0]!.cur)} (${fmtPct(T.expense > 0 ? (grpSorted[0]!.cur / T.expense) * 100 : null)}).`);
    }
    const g = grown[0];
    if (g && g.d > 0 && (P.expense > 0)) notes.push(`Eng ko'p o'sgan xarajat moddasi — ${leafName(g.k)}: ${signedSom(g.d)} (o'tgan teng davrga nisbatan).`);
    notes.push(...regionNotes);
    if (heads > 0) notes.push(`Davrda ${heads} nafar xodim ishlagan; bir xodimga daromad ${fmtSom(T.income / heads)}, ish haqi xarajatning ${fmtPct(T.expense > 0 ? (T.payroll / T.expense) * 100 : null)} i.`);
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    const now = new Date(Date.now() + 5 * 3600_000).toISOString();
    return {
      kind: 'Davr moliyaviy hisoboti',
      title: unit === 'all' ? 'Davr moliyaviy hisoboti' : `${unitName}: moliyaviy hisobot`,
      subtitle: `${unitName} · ${rangeText(range)}`,
      meta: [
        `Davr: ${rangeText(range)} (${days} kun)`,
        `Solishtirish: o'tgan teng davr ${rangeText(prev)}; o'tgan yil ${rangeText(year)}`,
        "Manba: Daromadlar, Xarajatlar va Xodimlar bo'limlari (o'chirilgan yozuvlar kirmaydi)",
      ],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Moliyaviy hisobot - ${unitName} - ${range.from}_${range.to}`),
      generatedAt: now,
    };
  }
}