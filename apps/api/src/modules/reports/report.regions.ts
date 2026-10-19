import { Injectable } from '@nestjs/common';
import { byUnit, mln, unitOrder } from './report.common';
import { daysIn, monthsOf, previousRange, rangeText, ReportData, yearAgoRange, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodShort, safeFile, signedSom } from './reports.format';
import { docMark, type Cell, type DocMark, type ReportDoc, type ReportParams, type ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Hududlar solishtirmasi: har bir hudud va Markaz — daromad, xarajat, natija,
// bir xodimga ko'rsatkichlar, xarajat tarkibi, oylar bo'yicha natija, reytinglar.
// ═══════════════════════════════════════════════════════════

@Injectable()
export class RegionsReport {
  constructor(private readonly data: ReportData) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const year = yearAgoRange(range);
    const labels = await this.data.labels();
    const { incomes, expenses } = await this.data.rows([range, prev, year]);
    const f = ReportData.inRange(range);
    const fp = ReportData.inRange(prev);
    const fy = ReportData.inRange(year);
    const cur = byUnit(incomes.filter(f), expenses.filter(f));
    const pr = byUnit(incomes.filter(fp), expenses.filter(fp));
    const ya = byUnit(incomes.filter(fy), expenses.filter(fy));
    const heads = await this.data.headcountByUnit(range);

    const keys = [...new Set([...cur.keys(), ...pr.keys(), ...[...labels.units.keys()].filter((k) => k.startsWith('r:') || k === 'center')])].filter((k) => k !== 'all');
    const rows = keys
      .map((k) => {
        const c = cur.get(k) ?? { income: 0, expense: 0, payroll: 0, lease: 0, vehicle: 0, other: 0 };
        const p = pr.get(k);
        const y = ya.get(k);
        const h = heads.get(k) ?? 0;
        const result = c.income - c.expense;
        return {
          key: k,
          name: labels.units.get(k) ?? k,
          ...c,
          result,
          margin: c.income > 0 ? (result / c.income) * 100 : null,
          heads: h,
          incomePerHead: h > 0 ? c.income / h : null,
          expensePerHead: h > 0 ? c.expense / h : null,
          prevResult: p ? p.income - p.expense : 0,
          yearResult: y ? y.income - y.expense : 0,
          prevIncome: p?.income ?? 0,
        };
      })
      // Shu yoki o'tgan davrda yozuvi bor birliklar (jami ustunlari qatorlar yig'indisiga teng bo'lishi uchun) va barcha hududlar
      .filter((r) => r.income !== 0 || r.expense !== 0 || r.prevResult !== 0 || r.key.startsWith('r:'))
      .sort((a, b) => unitOrder(a.key) - unitOrder(b.key) || b.result - a.result);
    const regions = rows.filter((r) => r.key.startsWith('r:') && (r.income !== 0 || r.expense !== 0));
    const center = rows.find((r) => r.key === 'center');
    const total = rows.reduce(
      (s, r) => ({ income: s.income + r.income, expense: s.expense + r.expense, heads: s.heads + r.heads }),
      { income: 0, expense: 0, heads: 0 },
    );
    // O'tgan davr natijasi — butun korxona (shu davrda yozuvi bo'lmagan birliklar ham kiradi)
    const prevTotal = [...pr.values()].reduce((s, u) => s + u.income - u.expense, 0);
    const sections: ReportSection[] = [];

    // ─────────── 1. Umumiy ko'rinish ───────────
    const winners = regions.filter((r) => r.result > 0);
    const regionsProfit = regions.reduce((s, r) => s + r.result, 0);
    const centerNet = center ? center.expense - center.income : 0;
    sections.push({
      title: "Umumiy ko'rinish",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Hududlar', value: `${winners.length} / ${regions.length}`, sub: 'foyda bilan ishlagan', tone: winners.length === regions.length ? 'good' : 'warn' },
            { label: 'Hududlar foydasi', value: fmtSom(regionsProfit), sub: 'Markazdan tashqari', tone: regionsProfit >= 0 ? 'good' : 'bad' },
            { label: 'Markaz sof xarajati', value: fmtSom(centerNet), sub: centerNet > 0 ? `qoplanishi ${fmtPct((regionsProfit / centerNet) * 100, 0)}` : undefined, tone: regionsProfit >= centerNet ? 'good' : 'bad' },
            { label: 'Korxona natijasi', value: fmtSom(total.income - total.expense), sub: `o'tgan teng davrga ${signedSom(total.income - total.expense - prevTotal)}`, tone: total.income - total.expense >= 0 ? 'good' : 'bad' },
          ],
        },
        {
          type: 'chart',
          title: 'Hududlar natijasi',
          kind: 'barh',
          unit: "mln so'm",
          labels: regions.map((r) => r.name),
          series: [{ name: 'Natija', values: regions.map((r) => mln(r.result)), color: PALETTE.navy }],
        },
      ],
    });

    // ─────────── 2. Asosiy jadval ───────────
    sections.push({
      title: 'Hududlar jadvali',
      intro: "Daromad — hududda bajarilgan ishlar; xarajat — hudud xarajatlari va xodimlari ish haqi.",
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Hudud', width: 1.8 },
            { label: 'Daromad', format: 'money' },
            { label: 'Xarajat', format: 'money' },
            { label: 'Natija', format: 'money', toneBy: 'up' },
            { label: 'Rentabellik', format: 'pct', width: 0.8 },
            { label: 'Xodimlar', format: 'int', width: 0.7 },
            { label: '1 xodimga daromad', format: 'money' },
            { label: "O'tgan davr natijasi", format: 'money' },
            { label: "Natija o'zgarishi", format: 'money', toneBy: 'up' },
          ],
          rows: rows.map((r) => [r.name, r.income, r.expense, r.result, r.margin, r.heads, r.incomePerHead, r.prevResult, r.result - r.prevResult] as Cell[]),
          marks: rows.map((r) => docMark('RESULT', `${r.name} · natija`, { unit: r.key })),
          total: ['Jami', total.income, total.expense, total.income - total.expense, total.income > 0 ? ((total.income - total.expense) / total.income) * 100 : null, total.heads, total.heads > 0 ? total.income / total.heads : null, prevTotal, total.income - total.expense - prevTotal],
          note: "«Natija o'zgarishi» — o'tgan teng davrga nisbatan. Xodimlar — davrda ishlagan (Xodimlar bo'limi).",
        },
      ],
    });

    // ─────────── 3. Samaradorlik ko'rsatkichlari ───────────
    const perHead = regions.filter((r) => r.incomePerHead !== null).sort((a, b) => (b.incomePerHead ?? 0) - (a.incomePerHead ?? 0));
    sections.push({
      title: "Bir xodimga ko'rsatkichlar",
      intro: "Hudud kattaligidan qat'i nazar solishtirish uchun.",
      blocks: [
        {
          type: 'chart',
          title: 'Bir xodimga daromad',
          kind: 'barh',
          unit: "mln so'm",
          labels: perHead.map((r) => r.name),
          series: [{ name: '1 xodimga daromad', values: perHead.map((r) => mln(r.incomePerHead ?? 0)), color: PALETTE.green }],
        },
        {
          type: 'table',
          columns: [
            { label: 'Hudud', width: 1.8 },
            { label: '1 xodimga daromad', format: 'money' },
            { label: '1 xodimga xarajat', format: 'money' },
            { label: '1 xodimga natija', format: 'money', toneBy: 'up' },
            { label: 'Daromad / xarajat', format: 'decimal', width: 0.8 },
          ],
          rows: perHead.map((r) => [r.name, r.incomePerHead, r.expensePerHead, r.heads > 0 ? r.result / r.heads : null, r.expense > 0 ? r.income / r.expense : null]),
          marks: perHead.map((r) => docMark('RESULT', `${r.name} · natija`, { unit: r.key })),
        },
      ],
    });

    // ─────────── 4. Xarajat tarkibi ───────────
    const share = (v: number, t: number) => (t > 0 ? (v / t) * 100 : null);
    sections.push({
      title: 'Xarajat tarkibi',
      intro: 'Har bir hudud xarajati nimadan iborat (ulush, %).',
      blocks: [
        {
          type: 'chart',
          title: 'Xarajat tarkibi hududlar bo\'yicha',
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: regions.map((r) => r.name),
          series: [
            { name: 'Ish haqi', values: regions.map((r) => mln(r.payroll)), color: PALETTE.navy },
            { name: 'Ijara', values: regions.map((r) => mln(r.lease)), color: PALETTE.ramp[2] },
            { name: 'Mashinalar', values: regions.map((r) => mln(r.vehicle)), color: PALETTE.amber },
            { name: 'Qolganlari', values: regions.map((r) => mln(r.other)), color: PALETTE.slate },
          ],
        },
        {
          type: 'table',
          columns: [
            { label: 'Hudud', width: 1.8 },
            { label: 'Xarajat', format: 'money' },
            { label: 'Ish haqi', format: 'pct', width: 0.8 },
            { label: 'Ijara', format: 'pct', width: 0.8 },
            { label: 'Mashinalar', format: 'pct', width: 0.8 },
            { label: 'Qolganlari', format: 'pct', width: 0.8 },
          ],
          rows: rows.map((r) => [r.name, r.expense, share(r.payroll, r.expense), share(r.lease, r.expense), share(r.vehicle, r.expense), share(r.other, r.expense)]),
        },
      ],
    });

    // ─────────── 5. Oylar bo'yicha natija ───────────
    const months = monthsOf(range);
    if (months.length > 1 && months.length <= 24) {
      const monthly = new Map<string, Map<string, number>>();
      const add = (unit: string, month: string, v: number) => {
        const m = monthly.get(unit) ?? new Map<string, number>();
        m.set(month, (m.get(month) ?? 0) + v);
        monthly.set(unit, m);
      };
      for (const r of incomes.filter(f)) add(r.unit, r.month, r.amount);
      for (const r of expenses.filter(f)) add(r.unit, r.month, -r.amount);
      const lossMonths = regions.map((r) => ({ r, n: months.filter((m) => (monthly.get(r.key)?.get(m) ?? 0) < 0).length }));
      sections.push({
        title: "Oylar bo'yicha natija",
        intro: "Har oy hudud natijasi (daromad − xarajat), mln so'm. Manfiy — zarar.",
        blocks: [
          {
            type: 'table',
            columns: [{ label: 'Hudud', width: 1.8 }, ...months.map((m) => ({ label: periodShort(m), format: 'mln' as const, toneBy: 'up' as const, width: 0.7 })), { label: 'Zararli oylar', format: 'int' as const, width: 0.7 }],
            rows: rows.map((r) => [r.name, ...months.map((m) => monthly.get(r.key)?.get(m) ?? 0), months.filter((m) => (monthly.get(r.key)?.get(m) ?? 0) < 0).length]),
            slideRows: 16,
          },
        ],
      });
      const chronic = lossMonths.filter((x) => x.n >= Math.ceil(months.length / 2));
      if (chronic.length) {
        sections[sections.length - 1]!.blocks.push({
          type: 'notes',
          items: [`Oylarning yarmidan ko'pida zarar ko'rgan hududlar: ${chronic.map((x) => `${x.r.name} (${x.n} oy)`).join(', ')}.`],
        });
      }
    }

    // ─────────── 6. Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${rangeText(range)} (${daysIn(range)} kun): ${regions.length} ta hududdan ${winners.length} tasi foyda, ${regions.length - winners.length} tasi zarar bilan ishladi.`);
    if (regions.length) {
      const best = regions[0]!;
      const worst = regions[regions.length - 1]!;
      notes.push(`Eng ko'p foyda — ${best.name}: ${fmtSom(best.result)} (rentabellik ${fmtPct(best.margin)}).`);
      if (worst.key !== best.key) notes.push(`${worst.result < 0 ? 'Eng katta zarar' : 'Eng kam foyda'} — ${worst.name}: ${fmtSom(worst.result)}.`);
    }
    if (centerNet > 0) {
      notes.push(`Markaz sof xarajati ${fmtSom(centerNet)}; hududlar foydasi ${fmtSom(regionsProfit)} — ${regionsProfit >= centerNet ? "uni to'liq qoplaydi" : `faqat ${fmtPct((regionsProfit / centerNet) * 100, 0)} ini qoplaydi`}.`);
    }
    if (perHead.length >= 2) {
      notes.push(`Bir xodimga daromad: eng yuqori — ${perHead[0]!.name} (${fmtSom(perHead[0]!.incomePerHead ?? 0)}), eng past — ${perHead[perHead.length - 1]!.name} (${fmtSom(perHead[perHead.length - 1]!.incomePerHead ?? 0)}).`);
    }
    const changes = regions.map((r) => ({ r, d: r.result - r.prevResult })).sort((a, b) => b.d - a.d);
    if (changes.length >= 2) {
      if (changes[0]!.d > 0) notes.push(`Natijasi eng ko'p yaxshilangan — ${changes[0]!.r.name} (${signedSom(changes[0]!.d)}).`);
      const w = changes[changes.length - 1]!;
      if (w.d < 0) notes.push(`Natijasi eng ko'p yomonlashgan — ${w.r.name} (${signedSom(w.d)}); daromadi ${fmtSignedPct(change(w.r.income, w.r.prevIncome))}.`);
    }
    const payrollHeavy = regions.filter((r) => r.expense > 0 && r.payroll / r.expense > 0.85);
    if (payrollHeavy.length) notes.push(`Xarajatining 85% dan ko'pi ish haqi bo'lgan hududlar: ${payrollHeavy.map((r) => r.name).join(', ')}.`);
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Hududlar solishtirmasi',
      title: 'Hududlar solishtirmasi',
      subtitle: `Barcha hududlar va Markaz · ${rangeText(range)}`,
      meta: [
        `Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`,
        "Daromad — hududda bajarilgan ishlar; xarajat — hudud xarajatlari va xodimlari ish haqi",
        "Manba: Daromadlar, Xarajatlar va Xodimlar bo'limlari",
      ],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Hududlar solishtirmasi - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}