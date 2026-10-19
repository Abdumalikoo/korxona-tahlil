import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { byExpenseGroup, mln, sumBy, unitOrder } from './report.common';
import { expenseGroup } from './report.financial';
import { dayStart, daysIn, isoOf, monthsOf, previousRange, rangeText, ReportData, unitKeyOf, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodLabel, periodShort, safeFile, signedSom, uzDate } from './reports.format';
import { docMark, type Cell, type DocMark, type ReportDoc, type ReportParams, type ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Xarajatlar tarkibi: guruhlar va moddalar (daraxt), oylar, eng ko'p o'zgarganlar,
// kontragentlar, eng katta yozuvlar, to'lov holati, hududlar.
// Manba — faqat Xarajatlar bo'limi.
// ═══════════════════════════════════════════════════════════

const DAY = 86_400_000;
const PAY = { PAID: "To'langan", PARTIAL: "Qisman to'langan", UNPAID: "To'lanmagan" } as const;

@Injectable()
export class ExpensesReport {
  constructor(
    private readonly data: ReportData,
    private readonly prisma: PrismaService,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const prev = previousRange(range);
    const labels = await this.data.labels();
    const unit = this.data.checkUnit(params.unit, labels);
    const unitName = labels.units.get(unit)!;
    const { expenses } = await this.data.rows([range, prev], unit);
    const cur = expenses.filter(ReportData.inRange(range));
    const pr = expenses.filter(ReportData.inRange(prev));
    const T = cur.reduce((s, r) => s + r.amount, 0);
    const TP = pr.reduce((s, r) => s + r.amount, 0);
    const doimiy = cur.filter((r) => r.section === 'DOIMIY').reduce((s, r) => s + r.amount, 0);
    const share = (v: number) => (T > 0 ? (v / T) * 100 : null);
    const sections: ReportSection[] = [];

    // Batafsil yozuvlar (kontragent, izoh, to'lov holati)
    const where = { deletedAt: null, date: { gte: dayStart(range.from), lt: new Date(dayStart(range.to).getTime() + DAY) } };
    const detailed = (
      await this.prisma.expense.findMany({
        where,
        select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, counterparty: true, description: true, paymentStatus: true, source: true },
      })
    )
      .map((r) => ({ ...r, amount: Number(r.amountTiyin) / 100, unit: unitKeyOf(r.regionCode, r.departmentId) }))
      .filter((r) => unit === 'all' || r.unit === unit);

    // ─────────── 1. Umumiy ───────────
    const groups = [...byExpenseGroup(cur, labels).entries()].sort((a, b) => b[1].amount - a[1].amount);
    const groupsPrev = byExpenseGroup(pr, labels);
    const cT = change(T, TP);
    sections.push({
      title: "Umumiy ko'rinish",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Jami xarajat', value: fmtSom(T), sub: `o'tgan teng davrga ${fmtSignedPct(cT)}`, tone: cT === null || Math.abs(cT) < 0.5 ? 'neutral' : cT > 0 ? 'bad' : 'good' },
            { label: 'Kunlik o\'rtacha', value: fmtSom(T / daysIn(range)), sub: `${detailed.length} ta yozuv` },
            { label: 'Doimiy xarajat', value: fmtPct(share(doimiy)), sub: `bir martalik (Boshqa) — ${fmtPct(share(T - doimiy))}` },
            { label: 'Eng katta guruh', value: groups[0]?.[1].label ?? '—', sub: groups[0] ? `${fmtSom(groups[0][1].amount)} (${fmtPct(share(groups[0][1].amount))})` : undefined },
          ],
        },
        {
          type: 'chart',
          title: 'Xarajat guruhlari',
          kind: 'barh',
          unit: "mln so'm",
          labels: groups.slice(0, 12).map(([, g]) => g.label),
          series: [{ name: 'Xarajat', values: groups.slice(0, 12).map(([, g]) => mln(g.amount)), color: PALETTE.expenseBar }],
        },
      ],
    });

    // ─────────── 2. Guruhlar va moddalar (daraxt) ───────────
    const leafKey = (r: { source: string; categoryCode: string }) => (r.source === 'PAYROLL' || r.source === 'LEASE' || r.source === 'VEHICLE' ? `src:${r.source}` : r.categoryCode);
    const leaf = sumBy(cur, leafKey);
    const leafPrev = sumBy(pr, leafKey);
    const leafName = (k: string) => (k === 'src:PAYROLL' ? 'Ish haqi' : k === 'src:LEASE' ? 'Ijara' : k === 'src:VEHICLE' ? 'Mashinalar' : labels.expenseCategory.get(k)?.label ?? k);
    const tree: Cell[][] = [];
    const tone: ('down' | null)[] = [];
    // Munosabat belgisi: guruh/modda kaliti → filtr
    const leafFilter = (k: string): Record<string, string> => (k.startsWith('src:') ? { source: k.slice(4) } : { categoryCode: k });
    const groupFilter = (k: string): Record<string, string> => (k.startsWith('root:') ? { rootCategoryCode: k.slice(5) } : leafFilter(k));
    const treeMarks: (DocMark | null)[] = [];
    for (const [key, g] of groups) {
      const gp = groupsPrev.get(key)?.amount ?? 0;
      tree.push([g.label.toUpperCase(), g.amount, share(g.amount), gp, change(g.amount, gp)]);
      tone.push('down');
      treeMarks.push(docMark('EXPENSE', `Guruh: ${g.label}`, groupFilter(key), unit));
      if (key.startsWith('root:')) {
        // Shu yoki o'tgan davrda yozuvi bor moddalar (o'tgan davr ustuni guruh summasiga teng bo'lishi uchun)
        const children = [...new Set([...leaf.keys(), ...leafPrev.keys()])]
          .filter((k) => !k.startsWith('src:') && expenseGroup({ source: 'MANUAL', categoryCode: k } as never, labels).key === key && k !== key.slice(5))
          .map((k) => [k, leaf.get(k) ?? 0] as [string, number])
          .sort((a, b) => b[1] - a[1]);
        const own = leaf.get(key.slice(5)) ?? 0;
        if (children.length > 0) {
          for (const [k, v] of children) {
            tree.push([`   ${leafName(k)}`, v, share(v), leafPrev.get(k) ?? 0, change(v, leafPrev.get(k) ?? 0)]);
            tone.push('down');
            treeMarks.push(docMark('EXPENSE', `Modda: ${leafName(k)}`, leafFilter(k), unit));
          }
          if (own > 0 || (leafPrev.get(key.slice(5)) ?? 0) > 0) {
            tree.push(['   (guruhning o\'zi)', own, share(own), leafPrev.get(key.slice(5)) ?? 0, change(own, leafPrev.get(key.slice(5)) ?? 0)]);
            tone.push('down');
            treeMarks.push(docMark('EXPENSE', `Modda: ${leafName(key.slice(5))}`, { categoryCode: key.slice(5) }, unit));
          }
        }
      }
    }
    sections.push({
      title: 'Guruhlar va moddalar',
      intro: 'Katta harflar — guruh, ichida — moddalar. O\'zgarish — o\'tgan teng davrga nisbatan (qizil — o\'sish).',
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Guruh / modda', width: 2.8 },
            { label: 'Summa', format: 'money' },
            { label: 'Ulush', format: 'pct', width: 0.7 },
            { label: "O'tgan teng davr", format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'row', width: 0.8 },
          ],
          rows: tree,
          marks: treeMarks,
          rowTone: tone,
          total: ['JAMI', T, 100, TP, cT],
        },
      ],
    });

    // ─────────── 3. Oylar bo'yicha ───────────
    const months = monthsOf(range);
    const topGroups = groups.slice(0, 5).map(([k, g]) => ({ k, label: g.label }));
    const monthGroup = new Map<string, Map<string, number>>();
    for (const r of cur) {
      const g = expenseGroup(r, labels).key;
      const key = topGroups.some((t) => t.k === g) ? g : 'rest';
      const m = monthGroup.get(r.month) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + r.amount);
      monthGroup.set(r.month, m);
    }
    const colKeys = [...topGroups.map((t) => t.k), ...(groups.length > 5 ? ['rest'] : [])];
    const colName = (k: string) => (k === 'rest' ? 'Qolganlari' : topGroups.find((t) => t.k === k)!.label);
    sections.push({
      title: "Oylar bo'yicha",
      blocks: [
        {
          type: 'chart',
          title: "Xarajat oylar bo'yicha (guruhlar)",
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: months.map(periodShort),
          series: colKeys.map((k, i) => ({ name: colName(k), values: months.map((m) => mln(monthGroup.get(m)?.get(k) ?? 0)), color: k === 'rest' ? PALETTE.slate : PALETTE.ramp[i] })),
        },
        {
          type: 'table',
          columns: [{ label: 'Oy', width: 1.3 }, ...colKeys.map((k) => ({ label: colName(k), format: 'money' as const })), { label: 'Jami', format: 'money' as const }],
          rows: months.map((m) => [periodLabel(m), ...colKeys.map((k) => monthGroup.get(m)?.get(k) ?? 0), [...(monthGroup.get(m)?.values() ?? [])].reduce((s, v) => s + v, 0)]),
          total: ['Jami', ...colKeys.map((k) => [...monthGroup.values()].reduce((s, m) => s + (m.get(k) ?? 0), 0)), T],
        },
      ],
    });

    // ─────────── 4. Eng ko'p o'zgargan moddalar ───────────
    const diffs = [...new Set([...leaf.keys(), ...leafPrev.keys()])].map((k) => ({ k, a: leaf.get(k) ?? 0, b: leafPrev.get(k) ?? 0, d: (leaf.get(k) ?? 0) - (leafPrev.get(k) ?? 0) }));
    const up = [...diffs].sort((a, b) => b.d - a.d).filter((x) => x.d > 0).slice(0, 10);
    const down = [...diffs].sort((a, b) => a.d - b.d).filter((x) => x.d < 0).slice(0, 10);
    const changeCols = [
      { label: 'Modda', width: 2.6 },
      { label: 'Shu davr', format: 'money' as const },
      { label: "O'tgan teng davr", format: 'money' as const },
      { label: 'Farq', format: 'money' as const, toneBy: 'down' as const },
      { label: "O'zgarish", format: 'signedPct' as const, toneBy: 'down' as const, width: 0.8 },
    ];
    if (TP > 0 && (up.length || down.length)) {
      sections.push({
        title: "Eng ko'p o'zgargan moddalar",
        blocks: [
          ...(up.length
            ? [{ type: 'table' as const, title: "Ko'paygan", columns: changeCols, rows: up.map((x) => [leafName(x.k), x.a, x.b, x.d, change(x.a, x.b)] as Cell[]), marks: up.map((x) => docMark('EXPENSE', `Modda: ${leafName(x.k)}`, leafFilter(x.k), unit)) }]
            : []),
          ...(down.length
            ? [{ type: 'table' as const, title: 'Kamaygan (tejalgan)', columns: changeCols, rows: down.map((x) => [leafName(x.k), x.a, x.b, x.d, change(x.a, x.b)] as Cell[]), marks: down.map((x) => docMark('EXPENSE', `Modda: ${leafName(x.k)}`, leafFilter(x.k), unit)) }]
            : []),
        ],
      });
    }

    // ─────────── 5. Kontragentlar ───────────
    const cp = new Map<string, { amount: number; count: number }>();
    for (const r of detailed) {
      const name = r.counterparty?.trim();
      if (!name) continue;
      const x = cp.get(name) ?? { amount: 0, count: 0 };
      x.amount += r.amount;
      x.count += 1;
      cp.set(name, x);
    }
    const cpSorted = [...cp.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const withCp = cpSorted.reduce((s, [, x]) => s + x.amount, 0);
    if (cpSorted.length) {
      sections.push({
        title: 'Kontragentlar',
        intro: `Kontragent ko'rsatilgan yozuvlar: ${fmtSom(withCp)} (${fmtPct(share(withCp))} xarajat). Ish haqi yozuvlarida odatda kontragent bo'lmaydi.`,
        blocks: [
          {
            type: 'table',
            title: 'Eng katta 20 ta kontragent',
            columns: [
              { label: 'Kontragent', width: 2.8 },
              { label: 'Summa', format: 'money' },
              { label: 'Ulush', format: 'pct', width: 0.7 },
              { label: 'Yozuvlar', format: 'int', width: 0.7 },
            ],
            rows: cpSorted.slice(0, 20).map(([n, x]) => [n, x.amount, share(x.amount), x.count]),
            marks: cpSorted.slice(0, 20).map(([n]) => docMark('EXPENSE', `Kontragent: ${n}`, { counterparty: n }, unit)),
          },
        ],
      });
    }

    // ─────────── 6. Eng katta yozuvlar ───────────
    const biggest = detailed.filter((r) => r.source !== 'PAYROLL').sort((a, b) => b.amount - a.amount).slice(0, 20);
    if (biggest.length) {
      sections.push({
        title: 'Eng katta yozuvlar',
        intro: 'Ish haqidan tashqari eng katta 20 ta xarajat yozuvi.',
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Sana', width: 0.8 },
              { label: 'Modda', width: 1.6 },
              { label: 'Hudud', width: 1.1 },
              { label: 'Kontragent / izoh', width: 2 },
              { label: 'Summa', format: 'money' },
            ],
            rows: biggest.map((r) => [
              uzDate(isoOf(r.date)),
              leafName(leafKey({ source: String(r.source), categoryCode: r.categoryCode })),
              labels.units.get(r.unit) ?? r.unit,
              [r.counterparty, r.description].filter(Boolean).join(' — ').slice(0, 80) || '—',
              r.amount,
            ]),
          },
        ],
      });
    }

    // ─────────── 7. To'lov holati va hududlar ───────────
    const pay = new Map<string, number>();
    for (const r of detailed) pay.set(String(r.paymentStatus), (pay.get(String(r.paymentStatus)) ?? 0) + r.amount);
    const unpaid = (pay.get('UNPAID') ?? 0) + (pay.get('PARTIAL') ?? 0);
    const blocks: ReportSection['blocks'] = [
      {
        type: 'table',
        title: "To'lov holati",
        columns: [{ label: 'Holat', width: 2 }, { label: 'Summa', format: 'money' }, { label: 'Ulush', format: 'pct', width: 0.7 }],
        rows: (Object.keys(PAY) as (keyof typeof PAY)[]).filter((k) => pay.get(k)).map((k) => [PAY[k], pay.get(k)!, share(pay.get(k)!)]),
      },
    ];
    if (unit === 'all') {
      const byU = sumBy(cur, (r) => r.unit);
      const byUP = sumBy(pr, (r) => r.unit);
      // Shu yoki o'tgan davrda xarajati bor birliklar
      for (const k of byUP.keys()) if (!byU.has(k)) byU.set(k, 0);
      const list = [...byU.entries()].sort((a, b) => unitOrder(a[0]) - unitOrder(b[0]) || b[1] - a[1]);
      blocks.push({
        type: 'table',
        title: "Hududlar bo'yicha",
        columns: [
          { label: 'Hudud', width: 2 },
          { label: 'Xarajat', format: 'money' },
          { label: 'Ulush', format: 'pct', width: 0.7 },
          { label: "O'tgan teng davr", format: 'money' },
          { label: "O'zgarish", format: 'signedPct', toneBy: 'down', width: 0.8 },
        ],
        rows: list.map(([k, v]) => [labels.units.get(k) ?? k, v, share(v), byUP.get(k) ?? 0, change(v, byUP.get(k) ?? 0)]),
        marks: list.map(([k]) => docMark('EXPENSE', `${labels.units.get(k) ?? k} · xarajat`, { unit: k })),
        total: ['Jami', T, 100, TP, cT],
      });
    }
    sections.push({ title: "To'lov holati va hududlar", blocks });

    // ─────────── 8. Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${unitName}, ${rangeText(range)}: jami xarajat ${fmtSom(T)} (kuniga o'rtacha ${fmtSom(T / daysIn(range))}); o'tgan teng davrga nisbatan ${fmtSignedPct(cT)} (${signedSom(T - TP)}).`);
    if (groups[0]) notes.push(`Eng katta guruh — ${groups[0][1].label}: ${fmtPct(share(groups[0][1].amount))}. Keyingilari: ${groups.slice(1, 3).map(([, g]) => `${g.label} (${fmtPct(share(g.amount))})`).join(', ')}.`);
    if (up[0]) notes.push(`Eng ko'p ko'paygan — ${leafName(up[0].k)}: ${signedSom(up[0].d)} (${fmtSignedPct(change(up[0].a, up[0].b))}).`);
    if (down[0]) notes.push(`Eng ko'p kamaygan — ${leafName(down[0].k)}: ${signedSom(down[0].d)}.`);
    if (cpSorted[0]) notes.push(`Eng katta kontragent — ${cpSorted[0][0]}: ${fmtSom(cpSorted[0][1].amount)}; eng katta 5 tasi — ${fmtPct(share(cpSorted.slice(0, 5).reduce((s, [, x]) => s + x.amount, 0)))} xarajat.`);
    if (unpaid > 0) notes.push(`To'lanmagan yoki qisman to'langan yozuvlar: ${fmtSom(unpaid)} (${fmtPct(share(unpaid))}).`);
    notes.push(`Bir martalik (Boshqa bo'limi) xarajatlar: ${fmtSom(T - doimiy)} (${fmtPct(share(T - doimiy))}).`);
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Xarajatlar tarkibi',
      title: unit === 'all' ? 'Xarajatlar tarkibi' : `${unitName}: xarajatlar tarkibi`,
      subtitle: `${unitName} · ${rangeText(range)}`,
      meta: [`Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`, "Manba: Xarajatlar bo'limi (ish haqi, ijara va mashinalar ham shu yerda)"],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Xarajatlar tarkibi - ${unitName} - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}