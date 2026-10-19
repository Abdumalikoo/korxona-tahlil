import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mln, unitOrder } from './report.common';
import { dayStart, daysIn, isoOf, monthsOf, previousRange, rangeText, ReportData, unitKeyOf, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodLabel, periodShort, safeFile, signedSom, uzDate } from './reports.format';
import { docMark, type Cell, type DocMark, type ReportDoc, type ReportParams, type ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Daromadlar tarkibi: xizmat turlari, oylar, mijozlar (konsentratsiya),
// to'lov holati va debitorlik, hududlar × xizmatlar, eng katta yozuvlar.
// Manba — faqat Daromadlar bo'limi.
// ═══════════════════════════════════════════════════════════

const DAY = 86_400_000;
const PAY = { PAID: "To'langan", PARTIAL: "Qisman to'langan", UNPAID: "To'lanmagan" } as const;

/**
 * To'lanmagan qism: holat bo'yicha. "To'langan" yozuvda qarz yo'q (paidTiyin to'ldirilmagan bo'lishi mumkin),
 * "To'lanmagan" — butun summa, "Qisman" — summa − to'langan qismi.
 */
function unpaidOf(status: string, amount: number, paid: number): number {
  if (status === 'PAID') return 0;
  if (status === 'UNPAID') return amount;
  return Math.max(0, amount - paid);
}

interface IncomeRow {
  date: Date;
  month: string;
  amount: number;
  paid: number;
  category: string;
  unit: string;
  client: string | null;
  quantity: number | null;
  status: string;
  description: string | null;
  /** To'lanmagan qism (so'm) */
  debt: number;
}

@Injectable()
export class IncomesReport {
  constructor(
    private readonly data: ReportData,
    private readonly prisma: PrismaService,
  ) {}

  private async load(range: Range, unit: string): Promise<IncomeRow[]> {
    const rows = await this.prisma.income.findMany({
      where: { deletedAt: null, date: { gte: dayStart(range.from), lt: new Date(dayStart(range.to).getTime() + DAY) } },
      select: { date: true, amountTiyin: true, paidTiyin: true, categoryCode: true, regionCode: true, departmentId: true, clientName: true, quantity: true, paymentStatus: true, description: true },
    });
    return rows
      .map((r) => ({
        date: r.date,
        month: isoOf(r.date).slice(0, 7),
        amount: Number(r.amountTiyin) / 100,
        paid: Number(r.paidTiyin) / 100,
        category: r.categoryCode,
        unit: unitKeyOf(r.regionCode, r.departmentId),
        client: r.clientName?.trim() || null,
        quantity: r.quantity,
        status: String(r.paymentStatus),
        description: r.description,
        debt: unpaidOf(String(r.paymentStatus), Number(r.amountTiyin) / 100, Number(r.paidTiyin) / 100),
      }))
      .filter((r) => unit === 'all' || r.unit === unit);
  }

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const labels = await this.data.labels();
    const unit = this.data.checkUnit(params.unit, labels);
    const unitName = labels.units.get(unit)!;
    const [cur, pr] = await Promise.all([this.load(range, unit), this.load(prev, unit)]);
    const T = cur.reduce((s, r) => s + r.amount, 0);
    const TP = pr.reduce((s, r) => s + r.amount, 0);
    const share = (v: number) => (T > 0 ? (v / T) * 100 : null);
    const name = (c: string) => labels.incomeCategory.get(c) ?? c;
    const sections: ReportSection[] = [];

    // ─────────── Xizmat turlari ───────────
    const cats = new Map<string, { amount: number; count: number; qty: number }>();
    for (const r of cur) {
      const x = cats.get(r.category) ?? { amount: 0, count: 0, qty: 0 };
      x.amount += r.amount;
      x.count += 1;
      x.qty += r.quantity ?? 0;
      cats.set(r.category, x);
    }
    const catsPrev = new Map<string, number>();
    for (const r of pr) catsPrev.set(r.category, (catsPrev.get(r.category) ?? 0) + r.amount);
    const catSorted = [...cats.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const cT = change(T, TP);
    const debt = cur.reduce((s, r) => s + r.debt, 0);

    sections.push({
      title: "Umumiy ko'rinish",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Jami daromad', value: fmtSom(T), sub: `o'tgan teng davrga ${fmtSignedPct(cT)}`, tone: cT === null || Math.abs(cT) < 0.5 ? 'neutral' : cT > 0 ? 'good' : 'bad' },
            { label: 'Yozuvlar', value: String(cur.length), sub: cur.length ? `o'rtacha ${fmtSom(T / cur.length)}` : undefined },
            { label: 'Asosiy xizmat', value: catSorted[0] ? name(catSorted[0][0]) : '—', sub: catSorted[0] ? fmtPct(share(catSorted[0][1].amount)) : undefined },
            { label: "To'lanmagan qism", value: fmtSom(debt), sub: `${fmtPct(share(debt))} daromad`, tone: debt > 0 ? 'warn' : 'good' },
          ],
        },
        {
          type: 'chart',
          title: 'Xizmat turlari',
          kind: 'barh',
          unit: "mln so'm",
          labels: catSorted.slice(0, 12).map(([c]) => name(c)),
          series: [{ name: 'Daromad', values: catSorted.slice(0, 12).map(([, x]) => mln(x.amount)), color: PALETTE.green }],
        },
      ],
    });

    sections.push({
      title: 'Xizmat turlari',
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Xizmat turi', width: 2.4 },
            { label: 'Summa', format: 'money' },
            { label: 'Ulush', format: 'pct', width: 0.7 },
            { label: 'Yozuvlar', format: 'int', width: 0.7 },
            { label: 'Soni (xizmat)', format: 'int', width: 0.8 },
            { label: "O'rtacha summa", format: 'money' },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'up', width: 0.8 },
          ],
          rows: [
            ...catSorted.map(([c, x]) => [name(c), x.amount, share(x.amount), x.count, x.qty || null, x.count ? x.amount / x.count : null, catsPrev.get(c) ?? 0, change(x.amount, catsPrev.get(c) ?? 0)] as Cell[]),
            // O'tgan davrda bo'lib, shu davrda yo'q xizmatlar
            ...[...catsPrev.entries()].filter(([c]) => !cats.has(c)).map(([c, v]) => [name(c), 0, 0, 0, null, null, v, change(0, v)] as Cell[]),
          ],
          total: ['Jami', T, 100, cur.length, catSorted.reduce((s, [, x]) => s + x.qty, 0) || null, cur.length ? T / cur.length : null, TP, cT],
          marks: [
            ...catSorted.map(([c]) => docMark('INCOME', `Xizmat turi: ${name(c)}`, { categoryCode: c }, unit)),
            ...[...catsPrev.keys()].filter((c) => !cats.has(c)).map((c) => docMark('INCOME', `Xizmat turi: ${name(c)}`, { categoryCode: c }, unit)),
          ],
          note: "«Soni» — yozuvlarda ko'rsatilgan xizmatlar soni (kiritilgan bo'lsa).",
        },
      ],
    });

    // ─────────── Oylar bo'yicha ───────────
    const months = monthsOf(range);
    const top = catSorted.slice(0, 5).map(([c]) => c);
    const mm = new Map<string, Map<string, number>>();
    for (const r of cur) {
      const key = top.includes(r.category) ? r.category : 'rest';
      const m = mm.get(r.month) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + r.amount);
      mm.set(r.month, m);
    }
    const cols = [...top, ...(catSorted.length > 5 ? ['rest'] : [])];
    const colName = (k: string) => (k === 'rest' ? 'Qolganlari' : name(k));
    sections.push({
      title: "Oylar bo'yicha",
      blocks: [
        {
          type: 'chart',
          title: "Daromad oylar bo'yicha (xizmat turlari)",
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: months.map(periodShort),
          series: cols.map((k, i) => ({ name: colName(k), values: months.map((m) => mln(mm.get(m)?.get(k) ?? 0)), color: k === 'rest' ? PALETTE.slate : ['2F7A57', '4F9A76', '7DB89A', 'A9D1BC', 'CFE5D9'][i] })),
        },
        {
          type: 'table',
          columns: [{ label: 'Oy', width: 1.3 }, ...cols.map((k) => ({ label: colName(k), format: 'money' as const })), { label: 'Jami', format: 'money' as const }],
          rows: months.map((m) => [periodLabel(m), ...cols.map((k) => mm.get(m)?.get(k) ?? 0), [...(mm.get(m)?.values() ?? [])].reduce((s, v) => s + v, 0)]),
          total: ['Jami', ...cols.map((k) => [...mm.values()].reduce((s, m) => s + (m.get(k) ?? 0), 0)), T],
        },
      ],
    });

    // ─────────── Mijozlar ───────────
    const clients = new Map<string, { amount: number; count: number; debt: number }>();
    for (const r of cur) {
      if (!r.client) continue;
      const x = clients.get(r.client) ?? { amount: 0, count: 0, debt: 0 };
      x.amount += r.amount;
      x.count += 1;
      x.debt += r.debt;
      clients.set(r.client, x);
    }
    const clientsPrev = new Map<string, number>();
    for (const r of pr) if (r.client) clientsPrev.set(r.client, (clientsPrev.get(r.client) ?? 0) + r.amount);
    const cl = [...clients.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const withClient = cl.reduce((s, [, x]) => s + x.amount, 0);
    const top5 = cl.slice(0, 5).reduce((s, [, x]) => s + x.amount, 0);
    const hhi = withClient > 0 ? cl.reduce((s, [, x]) => s + ((x.amount / withClient) * 100) ** 2, 0) : 0;
    const newClients = cl.filter(([n]) => !clientsPrev.has(n));
    const lost = [...clientsPrev.entries()].filter(([n]) => !clients.has(n)).sort((a, b) => b[1] - a[1]);
    if (cl.length) {
      sections.push({
        title: 'Mijozlar',
        intro: `Mijoz ko'rsatilgan yozuvlar: ${fmtSom(withClient)} (${fmtPct(share(withClient))} daromad), ${cl.length} ta mijoz.`,
        blocks: [
          {
            type: 'kpis',
            items: [
              { label: 'Mijozlar', value: String(cl.length), sub: `${newClients.length} ta yangi, ${lost.length} ta ketgan` },
              { label: 'Eng katta 5 tasi', value: fmtPct(withClient > 0 ? (top5 / withClient) * 100 : null), sub: 'mijozli daromaddagi ulushi', tone: withClient > 0 && top5 / withClient > 0.5 ? 'warn' : 'neutral' },
              { label: 'Konsentratsiya (HHI)', value: String(Math.round(hhi)), sub: hhi > 2500 ? 'yuqori — bir necha mijozga bog\'liq' : hhi > 1500 ? "o'rtacha" : 'past — xavf taqsimlangan', tone: hhi > 2500 ? 'bad' : 'neutral' },
              { label: "Mijozlar qarzi", value: fmtSom(cl.reduce((s, [, x]) => s + x.debt, 0)), tone: 'neutral' },
            ],
          },
          {
            type: 'table',
            title: 'Eng katta 20 ta mijoz',
            columns: [
              { label: 'Mijoz', width: 2.6 },
              { label: 'Summa', format: 'money' },
              { label: 'Ulush', format: 'pct', width: 0.7 },
              { label: 'Yozuvlar', format: 'int', width: 0.7 },
              { label: "To'lanmagan", format: 'money' },
              { label: "O'zgarish", format: 'signedPct', toneBy: 'up', width: 0.8 },
            ],
            rows: cl.slice(0, 20).map(([n, x]) => [n, x.amount, share(x.amount), x.count, x.debt || null, clientsPrev.has(n) ? change(x.amount, clientsPrev.get(n)!) : 'yangi']),
            marks: cl.slice(0, 20).map(([n]) => docMark('INCOME', `Mijoz: ${n}`, { clientName: n }, unit)),
          },
          ...(lost.length
            ? [
                {
                  type: 'table' as const,
                  title: "O'tgan davrda bo'lgan, bu davrda yo'q mijozlar",
                  columns: [{ label: 'Mijoz', width: 2.6 }, { label: "O'tgan davrda", format: 'money' as const }],
                  rows: lost.slice(0, 10).map(([n, v]) => [n, v] as Cell[]),
                  marks: lost.slice(0, 10).map(([n]) => docMark('INCOME', `Mijoz: ${n}`, { clientName: n }, unit)),
                },
              ]
            : []),
        ],
      });
    }

    // ─────────── To'lov holati ───────────
    const pay = new Map<string, { amount: number; debt: number }>();
    for (const r of cur) {
      const x = pay.get(r.status) ?? { amount: 0, debt: 0 };
      x.amount += r.amount;
      x.debt += r.debt;
      pay.set(r.status, x);
    }
    const debtors = cur
      .filter((r) => r.debt > 0)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 15);
    sections.push({
      title: "To'lov holati",
      intro: "Daromad yozuvlaridagi to'lov holati va to'lanmagan qism (debitorlik).",
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'Holat', width: 2 }, { label: 'Summa', format: 'money' }, { label: 'Ulush', format: 'pct', width: 0.7 }, { label: "To'lanmagan qism", format: 'money' }],
          rows: (Object.keys(PAY) as (keyof typeof PAY)[]).filter((k) => pay.get(k)).map((k) => [PAY[k], pay.get(k)!.amount, share(pay.get(k)!.amount), pay.get(k)!.debt]),
          total: ['Jami', T, 100, debt],
        },
        ...(debtors.length
          ? [
              {
                type: 'table' as const,
                title: "Eng katta to'lanmagan yozuvlar",
                columns: [
                  { label: 'Sana', width: 0.8 },
                  { label: 'Mijoz', width: 2 },
                  { label: 'Xizmat', width: 1.4 },
                  { label: 'Summa', format: 'money' as const },
                  { label: "To'lanmagan", format: 'money' as const },
                  { label: 'Kun', format: 'int' as const, width: 0.5 },
                ],
                rows: debtors.map((r) => [uzDate(isoOf(r.date)), r.client ?? '—', name(r.category), r.amount, r.debt, Math.floor((Date.now() - r.date.getTime()) / DAY)] as Cell[]),
                note: '«Kun» — yozuv sanasidan bugungacha o\'tgan kunlar.',
              },
            ]
          : []),
      ],
    });

    // ─────────── Hududlar × xizmatlar ───────────
    if (unit === 'all') {
      const cols5 = catSorted.slice(0, 5).map(([c]) => c);
      const matrix = new Map<string, Map<string, number>>();
      const unitPrev = new Map<string, number>();
      for (const r of pr) unitPrev.set(r.unit, (unitPrev.get(r.unit) ?? 0) + r.amount);
      for (const r of cur) {
        const m = matrix.get(r.unit) ?? new Map<string, number>();
        const key = cols5.includes(r.category) ? r.category : 'rest';
        m.set(key, (m.get(key) ?? 0) + r.amount);
        m.set('total', (m.get('total') ?? 0) + r.amount);
        matrix.set(r.unit, m);
      }
      for (const k of unitPrev.keys()) if (!matrix.has(k)) matrix.set(k, new Map([['total', 0]]));
      const list = [...matrix.entries()].sort((a, b) => unitOrder(a[0]) - unitOrder(b[0]) || (b[1].get('total') ?? 0) - (a[1].get('total') ?? 0));
      sections.push({
        title: 'Hududlar va xizmatlar',
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Hudud', width: 1.6 },
              ...cols5.map((c) => ({ label: name(c), format: 'money' as const })),
              ...(catSorted.length > 5 ? [{ label: 'Qolganlari', format: 'money' as const }] : []),
              { label: 'Jami', format: 'money' as const },
              { label: "O'tgan teng davr", format: 'money' as const },
              { label: "O'zgarish", format: 'signedPct' as const, toneBy: 'up' as const, width: 0.8 },
            ],
            rows: list.map(([k, m]) => [labels.units.get(k) ?? k, ...cols5.map((c) => m.get(c) ?? 0), ...(catSorted.length > 5 ? [m.get('rest') ?? 0] : []), m.get('total') ?? 0, unitPrev.get(k) ?? 0, change(m.get('total') ?? 0, unitPrev.get(k) ?? 0)]),
            marks: list.map(([k]) => docMark('INCOME', `${labels.units.get(k) ?? k} · daromad`, { unit: k })),
          },
        ],
      });
    }

    // ─────────── Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${unitName}, ${rangeText(range)}: jami daromad ${fmtSom(T)} (${cur.length} ta yozuv); o'tgan teng davrga nisbatan ${fmtSignedPct(cT)} (${signedSom(T - TP)}).`);
    if (catSorted[0]) notes.push(`Asosiy xizmat — ${name(catSorted[0][0])}: ${fmtPct(share(catSorted[0][1].amount))}.${catSorted[1] ? ` Keyingi — ${name(catSorted[1][0])} (${fmtPct(share(catSorted[1][1].amount))}).` : ''}`);
    // Shu yoki o'tgan davrda bo'lgan barcha xizmatlar (butunlay to'xtagani ham)
    const growth = [...new Set([...cats.keys(), ...catsPrev.keys()])].map((c) => ({ c, d: (cats.get(c)?.amount ?? 0) - (catsPrev.get(c) ?? 0) })).sort((a, b) => b.d - a.d);
    if (growth[0] && growth[0].d > 0 && TP > 0) notes.push(`Eng ko'p o'sgan xizmat — ${name(growth[0].c)} (${signedSom(growth[0].d)}).`);
    const fall = growth[growth.length - 1];
    if (fall && fall.d < 0) notes.push(`Eng ko'p kamaygan xizmat — ${name(fall.c)} (${signedSom(fall.d)}).`);
    if (cl.length) notes.push(`Eng katta 5 mijoz mijozli daromadning ${fmtPct(withClient > 0 ? (top5 / withClient) * 100 : null)} ini beradi; ${newClients.length} ta yangi mijoz, ${lost.length} ta mijoz bu davrda xizmat olmagan.`);
    if (debt > 0) notes.push(`To'lanmagan daromad: ${fmtSom(debt)} (${fmtPct(share(debt))}).`);
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Daromadlar tarkibi',
      title: unit === 'all' ? 'Daromadlar tarkibi' : `${unitName}: daromadlar tarkibi`,
      subtitle: `${unitName} · ${rangeText(range)}`,
      meta: [`Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`, "Manba: Daromadlar bo'limi"],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Daromadlar tarkibi - ${unitName} - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}