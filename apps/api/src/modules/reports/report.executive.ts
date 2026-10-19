import { Injectable } from '@nestjs/common';
import { ScenarioService } from '../econ/econ.scenario';
import { EconService } from '../econ/econ.service';
import { ControlsService } from '../reactions/controls.service';
import { ReactionsService } from '../reactions/reactions.service';
import { byExpenseGroup, byUnit, mln, sumBy } from './report.common';
import { daysIn, monthsOf, previousRange, rangeText, ReportData, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodShort, safeFile, signedSom } from './reports.format';
import type { Cell, KpiItem, ReportDoc, ReportParams, ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Rahbariyat uchun qisqa hisobot: bir qarashda natija, nima o'zgardi,
// hududlar, xavflar va tavsiyalar — 2–3 sahifa.
// ═══════════════════════════════════════════════════════════

@Injectable()
export class ExecutiveReport {
  constructor(
    private readonly data: ReportData,
    private readonly econ: EconService,
    private readonly scenarios: ScenarioService,
    private readonly reactions: ReactionsService,
    private readonly controls: ControlsService,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const labels = await this.data.labels();
    // Dinamika uchun: davr oxiridan 12 oy orqaga
    const trendFrom = (() => {
      const y = Number(range.to.slice(0, 4));
      const m = Number(range.to.slice(5, 7));
      const d = new Date(Date.UTC(y, m - 12, 1));
      return d.toISOString().slice(0, 10) < range.from ? d.toISOString().slice(0, 10) : range.from;
    })();
    const trend: Range = { from: trendFrom, to: range.to };
    const { incomes, expenses } = await this.data.rows([range, prev, trend]);
    const f = ReportData.inRange(range);
    const fp = ReportData.inRange(prev);
    const inc = incomes.filter(f);
    const exp = expenses.filter(f);
    const incP = incomes.filter(fp);
    const expP = expenses.filter(fp);
    const I = inc.reduce((s, r) => s + r.amount, 0);
    const E = exp.reduce((s, r) => s + r.amount, 0);
    const IP = incP.reduce((s, r) => s + r.amount, 0);
    const EP = expP.reduce((s, r) => s + r.amount, 0);
    const R = I - E;
    const RP = IP - EP;
    const margin = I > 0 ? (R / I) * 100 : null;
    const sections: ReportSection[] = [];

    // Qo'shimcha manbalar (xato bo'lsa ham hisobot chiqadi)
    const [yearInc, yearExp, yearRes, risk, reactionList, controlList, overview] = await Promise.all([
      this.econ.forecast({ target: 'income', unit: 'all', horizon: '3' }).catch(() => null),
      this.econ.forecast({ target: 'expense', unit: 'all', horizon: '3' }).catch(() => null),
      this.econ.forecast({ target: 'result', unit: 'all', horizon: '3' }).catch(() => null),
      this.scenarios.risk({ horizon: '3' }).catch(() => null),
      this.reactions.list().catch(() => []),
      this.controls.list().catch(() => []),
      this.econ.overview().catch(() => null),
    ]);

    // ─────────── 1. Bir qarashda ───────────
    const cI = change(I, IP);
    const cE = change(E, EP);
    const toneUp = (c: number | null) => (c === null || Math.abs(c) < 0.5 ? 'neutral' : c > 0 ? 'good' : 'bad') as KpiItem['tone'];
    const totalRisk = risk?.units.find((u) => u.kind === 'total');
    const openReactions = reactionList.filter((r) => r.status === 'OPEN');
    const overdue = openReactions.filter((r) => r.overdue);
    const activeControls = controlList.filter((c) => c.isActive);
    const breached = activeControls.filter((c) => c.status === 'breach');
    const atRisk = activeControls.filter((c) => c.status === 'risk');
    sections.push({
      title: 'Bir qarashda',
      intro: `${rangeText(range)}; solishtirish — o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Daromad', value: fmtSom(I), sub: `${fmtSignedPct(cI)} o'tgan davrga`, tone: toneUp(cI) },
            { label: 'Xarajat', value: fmtSom(E), sub: `${fmtSignedPct(cE)} o'tgan davrga`, tone: toneUp(cE === null ? null : -cE) },
            { label: R >= 0 ? 'Foyda' : 'Zarar', value: fmtSom(R), sub: `${signedSom(R - RP)} o'tgan davrga`, tone: R >= 0 ? 'good' : 'bad' },
            { label: 'Rentabellik', value: fmtPct(margin), sub: `o'tgan davrda ${fmtPct(IP > 0 ? (RP / IP) * 100 : null)}`, tone: margin !== null && margin < 0 ? 'bad' : 'neutral' },
          ],
        },
        {
          type: 'kpis',
          items: [
            {
              label: `${yearRes?.yearEnd?.year ?? ''}-yil natijasi (butun yil, prognoz)`,
              value: yearRes?.yearEnd ? fmtSom(Number(yearRes.yearEnd.totalTiyin) / 100) : '—',
              sub:
                yearInc?.yearEnd && yearExp?.yearEnd
                  ? `daromad ${fmtSom(Number(yearInc.yearEnd.totalTiyin) / 100)} − xarajat ${fmtSom(Number(yearExp.yearEnd.totalTiyin) / 100)}`
                  : undefined,
              tone: yearRes?.yearEnd ? (Number(yearRes.yearEnd.totalTiyin) >= 0 ? 'good' : 'bad') : 'neutral',
            },
            {
              label: 'Zarar ehtimoli, 3 oy',
              value: totalRisk ? fmtPct(totalRisk.lossProbability * 100, 0) : '—',
              sub: risk ? `yuqori xavfli hududlar: ${risk.units.filter((u) => u.kind === 'region' && u.level === 'high').length}` : undefined,
              tone: totalRisk && totalRisk.lossProbability >= 0.2 ? 'bad' : 'neutral',
            },
            { label: 'Munosabatlar', value: `${openReactions.length} ochiq`, sub: overdue.length ? `${overdue.length} tasining muddati o'tgan` : "muddati o'tgani yo'q", tone: overdue.length ? 'warn' : 'neutral' },
            { label: 'Nazorat', value: `${breached.length} buzilgan`, sub: `${activeControls.length} ta moddadan; ${atRisk.length} tasi xavf ostida`, tone: breached.length ? 'bad' : 'good' },
          ],
        },
      ],
    });

    // ─────────── 2. Natija dinamikasi ───────────
    const months = monthsOf(trend);
    const ft = ReportData.inRange(trend);
    const incM = sumBy(incomes.filter(ft), (r) => r.month);
    const expM = sumBy(expenses.filter(ft), (r) => r.month);
    sections.push({
      title: 'Natija dinamikasi',
      intro: `Oxirgi ${months.length} oy (${periodShort(months[0]!)} – ${periodShort(months[months.length - 1]!)}).`,
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
      ],
    });

    // ─────────── 3. Nima o'zgardi: natijaga eng katta ta'sir ───────────
    const incCat = sumBy(inc, (r) => r.categoryCode);
    const incCatP = sumBy(incP, (r) => r.categoryCode);
    const grp = byExpenseGroup(exp, labels);
    const grpP = byExpenseGroup(expP, labels);
    const drivers = [
      ...[...new Set([...incCat.keys(), ...incCatP.keys()])].map((k) => {
        const a = incCat.get(k) ?? 0;
        const b = incCatP.get(k) ?? 0;
        return { name: labels.incomeCategory.get(k) ?? k, kind: 'Daromad', a, b, effect: a - b };
      }),
      ...[...new Set([...grp.keys(), ...grpP.keys()])].map((k) => {
        const a = grp.get(k)?.amount ?? 0;
        const b = grpP.get(k)?.amount ?? 0;
        return { name: grp.get(k)?.label ?? grpP.get(k)?.label ?? k, kind: 'Xarajat', a, b, effect: -(a - b) };
      }),
    ]
      .filter((d) => Math.abs(d.effect) > 0)
      .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect))
      .slice(0, 8);
    if (drivers.length && (IP || EP)) {
      sections.push({
        title: "Nima o'zgardi",
        intro: "Natijaga eng katta ta'sir qilgan moddalar (o'tgan teng davrga nisbatan). Ta'sir: daromad o'sishi va xarajat kamayishi — musbat.",
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Modda', width: 2.4 },
              { label: 'Turi', width: 0.8 },
              { label: 'Shu davr', format: 'money' },
              { label: "O'tgan davr", format: 'money' },
              { label: "Natijaga ta'siri", format: 'money', toneBy: 'up' },
            ],
            rows: drivers.map((d) => [d.name, d.kind, d.a, d.b, d.effect] as Cell[]),
            note: "Jadvalda natijaga eng katta ta'sir qilgan 8 ta modda; oxirgi qator — barcha moddalar bo'yicha natija va uning o'zgarishi.",
            total: ['Natija (barcha moddalar)', null, R, RP, R - RP],
          },
        ],
      });
    }

    // ─────────── 4. Hududlar ───────────
    const units = byUnit(inc, exp);
    const unitsP = byUnit(incP, expP);
    const regions = [...units.entries()]
      .filter(([k]) => k.startsWith('r:'))
      .map(([k, u]) => ({ k, name: labels.units.get(k) ?? k, r: u.income - u.expense, i: u.income, d: u.income - u.expense - ((unitsP.get(k)?.income ?? 0) - (unitsP.get(k)?.expense ?? 0)) }))
      .sort((a, b) => b.r - a.r);
    if (regions.length >= 2) {
      const top = regions.slice(0, 3);
      const bottom = regions.slice(-3).reverse().filter((x) => !top.includes(x));
      sections.push({
        title: 'Hududlar: eng yaxshi va eng past',
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Hudud', width: 2 },
              { label: "O'rin", width: 0.6 },
              { label: 'Daromad', format: 'money' },
              { label: 'Natija', format: 'money', toneBy: 'up' },
              { label: "Natija o'zgarishi", format: 'money', toneBy: 'up' },
            ],
            rows: [...top, ...bottom].map((x) => [x.name, `${regions.indexOf(x) + 1} / ${regions.length}`, x.i, x.r, x.d]),
          },
        ],
      });
    }

    // ─────────── 5. Xavflar va e'tibor ───────────
    const risks: string[] = [];
    const losing = regions.filter((x) => x.r < 0);
    if (losing.length) risks.push(`Zararda ishlagan hududlar: ${losing.map((x) => `${x.name} (${fmtSom(x.r)})`).join(', ')}.`);
    const highRisk = risk?.units.filter((u) => u.kind === 'region' && u.level !== 'low') ?? [];
    if (highRisk.length) risks.push(`Keyingi 3 oyda zararga tushish xavfi bor: ${highRisk.map((u) => `${u.name} (${fmtPct(u.lossProbability * 100, 0)})`).join(', ')}.`);
    if (breached.length) risks.push(`Nazorat chegarasi buzilgan: ${breached.slice(0, 5).map((c) => `«${c.label}»`).join(', ')}${breached.length > 5 ? ` va yana ${breached.length - 5} ta` : ''}.`);
    if (atRisk.length) risks.push(`Chegaradan chiqish xavfi: ${atRisk.slice(0, 5).map((c) => `«${c.label}»`).join(', ')}.`);
    if (overdue.length) risks.push(`Muddati o'tgan munosabatlar: ${overdue.slice(0, 5).map((r) => `«${r.title}»`).join(', ')}.`);
    const grown = drivers.filter((d) => d.kind === 'Xarajat' && d.effect < 0);
    if (grown.length) risks.push(`Eng ko'p o'sgan xarajat: ${grown[0]!.name} (${signedSom(-grown[0]!.effect)}, ${fmtSignedPct(change(grown[0]!.a, grown[0]!.b))}).`);
    for (const w of overview?.warnings.filter((x) => x.level === 'warn').slice(0, 2) ?? []) risks.push(`Ma'lumot sifati: ${w.text}`);
    if (!risks.length) risks.push('Jiddiy xavf aniqlanmadi.');

    // ─────────── 6. Tavsiyalar ───────────
    const advice: string[] = [];
    const withReaction = new Set(openReactions.map((r) => r.title.toLowerCase()));
    for (const x of losing.slice(-2)) {
      if (![...withReaction].some((t) => t.includes(x.name.toLowerCase()))) advice.push(`${x.name} bo'yicha Munosabat ochish: zarar ${fmtSom(x.r)} — daromadni oshirish yoki xarajatni qisqartirish rejasi, mas'ul va muddat bilan.`);
    }
    if (grown[0] && Math.abs(grown[0].effect) > Math.abs(R - RP) * 0.3) advice.push(`«${grown[0].name}» xarajatining o'sish sababini aniqlash va oylik chegara bilan Nazoratga qo'yish.`);
    if (breached.length) advice.push(`Buzilgan ${breached.length} ta nazorat bo'yicha mas'ullardan tushuntirish olish.`);
    if (overdue.length) advice.push(`Muddati o'tgan ${overdue.length} ta munosabat bo'yicha natijani muhokama qilib, yopish yoki Nazoratga o'tkazish.`);
    if (yearRes?.yearEnd && Number(yearRes.yearEnd.totalTiyin) < 0) advice.push("Prognozga ko'ra yil zarar bilan yakunlanishi mumkin — xarajatlarni qisqartirish stsenariysini (Katta modellar → Stsenariy) ko'rib chiqish.");
    if (!advice.length) advice.push("Joriy yo'nalishni saqlash; oylik ko'rsatkichlarni Nazorat orqali kuzatib borish.");

    sections.push({ title: "Xavflar va e'tibor talab qiladigan joylar", blocks: [{ type: 'notes', items: risks }] });
    sections.push({ title: 'Tavsiyalar', blocks: [{ type: 'notes', items: advice }] });

    const summary = [
      `${rangeText(range)} (${daysIn(range)} kun): daromad ${fmtSom(I)}, xarajat ${fmtSom(E)}, ${R >= 0 ? 'foyda' : 'zarar'} ${fmtSom(Math.abs(R))}${margin !== null ? ` (rentabellik ${fmtPct(margin)})` : ''}.`,
      `O'tgan teng davrga nisbatan: daromad ${fmtSignedPct(cI)}, xarajat ${fmtSignedPct(cE)}; natija ${R - RP >= 0 ? 'yaxshilandi' : 'yomonlashdi'} (${signedSom(R - RP)}).`,
      ...(drivers[0] ? [`Natijaga eng katta ta'sir — ${drivers[0].name} (${drivers[0].kind.toLowerCase()}): ${signedSom(drivers[0].effect)}.`] : []),
      ...(yearRes?.yearEnd
        ? [yearRes.notes.find((n) => n.startsWith(`${yearRes.yearEnd!.year}-yil jami natija`)) ?? `Prognoz: ${yearRes.yearEnd.year}-yil natijasi ~${fmtSom(Number(yearRes.yearEnd.totalTiyin) / 100)}.`]
        : []),
      ...risks.slice(0, 2),
    ];

    return {
      kind: 'Rahbariyat uchun hisobot',
      title: 'Rahbariyat uchun qisqa hisobot',
      subtitle: `Butun korxona · ${rangeText(range)}`,
      meta: [
        `Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`,
        `Dinamika: ${rangeText(trend)}`,
        "Manba: Daromadlar, Xarajatlar, Xodimlar; Katta modellar, Munosabat va Nazorat",
      ],
      highlights: summary.slice(0, 6),
      sections,
      fileBase: safeFile(`Rahbariyat uchun hisobot - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}