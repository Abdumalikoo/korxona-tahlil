import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mln, unitOrder } from './report.common';
import { dayStart, daysIn, monthsOf, previousRange, rangeText, ReportData, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, PALETTE, periodLabel, periodShort, safeFile, signedSom } from './reports.format';
import type { Cell, ReportDoc, ReportParams, ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Ish haqi va xodimlar.
// Ish haqi — Xarajatlar bo'limidagi ish haqi yozuvlari; xodimlar — Xodimlar bo'limi.
// (Ish haqi vedomostlari alohida ishlatilmaydi — faqat takrorlanishni tekshirish uchun.)
// ═══════════════════════════════════════════════════════════

const TZ = 5 * 3600_000;
const DAY = 86_400_000;

function monthBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1) - TZ), end: new Date(Date.UTC(y, m, 1) - TZ) };
}

@Injectable()
export class PayrollReport {
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
    const { incomes, expenses } = await this.data.rows([range, prev], unit);
    const f = ReportData.inRange(range);
    const fp = ReportData.inRange(prev);
    const pay = expenses.filter((r) => f(r) && r.source === 'PAYROLL');
    const payPrev = expenses.filter((r) => fp(r) && r.source === 'PAYROLL');
    const allExp = expenses.filter(f).reduce((s, r) => s + r.amount, 0);
    const inc = incomes.filter(f);
    const P = pay.reduce((s, r) => s + r.amount, 0);
    const PP = payPrev.reduce((s, r) => s + r.amount, 0);
    const I = inc.reduce((s, r) => s + r.amount, 0);

    // Xodimlar
    const employees = (await this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true, employmentType: true, position: true } })).filter(
      (e) => (e.isActive || e.firedAt !== null) && (unit === 'all' || (e.regionCode === 0 ? 'center' : `r:${e.regionCode}`) === unit),
    );
    const worked = (b: { start: Date; end: Date }) => employees.filter((e) => (!e.hiredAt || e.hiredAt < b.end) && (!e.firedAt || e.firedAt >= b.start));
    const rb = { start: dayStart(range.from), end: new Date(dayStart(range.to).getTime() + DAY) };
    const pb = { start: dayStart(prev.from), end: new Date(dayStart(prev.to).getTime() + DAY) };
    const inRange = worked(rb);
    const inPrev = worked(pb);
    const months = monthsOf(range);
    const payM = new Map<string, number>();
    for (const r of pay) payM.set(r.month, (payM.get(r.month) ?? 0) + r.amount);
    const incM = new Map<string, number>();
    for (const r of inc) incM.set(r.month, (incM.get(r.month) ?? 0) + r.amount);
    const headsM = months.map((m) => worked(monthBounds(m)).length);
    const avgHeads = headsM.length ? headsM.reduce((s, v) => s + v, 0) / headsM.length : 0;
    const payMonths = months.filter((m) => (payM.get(m) ?? 0) > 0).length || 1;
    const perHeadMonth = avgHeads > 0 ? P / payMonths / avgHeads : null;
    const hired = employees.filter((e) => e.hiredAt && e.hiredAt >= rb.start && e.hiredAt < rb.end);
    const fired = employees.filter((e) => e.firedAt && e.firedAt >= rb.start && e.firedAt < rb.end);
    const sections: ReportSection[] = [];
    const cP = change(P, PP);

    sections.push({
      title: "Umumiy ko'rinish",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Ish haqi xarajati', value: fmtSom(P), sub: `o'tgan teng davrga ${fmtSignedPct(cP)}`, tone: cP === null || Math.abs(cP) < 0.5 ? 'neutral' : cP > 0 ? 'bad' : 'good' },
            { label: 'Xodimlar', value: String(inRange.length), sub: `oylik o'rtacha ${avgHeads.toFixed(0)}; o'tgan davrda ${inPrev.length}` },
            { label: '1 xodimga oyiga', value: perHeadMonth === null ? '—' : fmtSom(perHeadMonth), sub: 'ish haqi xarajati' },
            { label: 'Xarajatdagi ulushi', value: fmtPct(allExp > 0 ? (P / allExp) * 100 : null), sub: I > 0 ? `daromadning ${fmtPct((P / I) * 100)} i` : undefined },
          ],
        },
      ],
    });

    // ─────────── Oylar bo'yicha ───────────
    const med = (() => {
      const vals = months.map((m) => payM.get(m) ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)]! : 0;
    })();
    sections.push({
      title: "Oylar bo'yicha",
      blocks: [
        {
          type: 'chart',
          title: 'Ish haqi xarajati va xodimlar soni',
          kind: 'bar',
          unit: "mln so'm",
          labels: months.map(periodShort),
          series: [{ name: 'Ish haqi', values: months.map((m) => mln(payM.get(m) ?? 0)), color: PALETTE.navy }],
        },
        {
          type: 'table',
          columns: [
            { label: 'Oy', width: 1.3 },
            { label: 'Ish haqi', format: 'money' },
            { label: 'Xodimlar', format: 'int', width: 0.7 },
            { label: '1 xodimga', format: 'money' },
            { label: 'Daromad', format: 'money' },
            { label: 'Ish haqi / daromad', format: 'pct', width: 0.9 },
          ],
          rows: months.map((m, i) => {
            const p = payM.get(m) ?? 0;
            const d = incM.get(m) ?? 0;
            return [periodLabel(m) + (med > 0 && p > med * 1.6 ? ' (!)' : ''), p, headsM[i]!, headsM[i]! > 0 ? p / headsM[i]! : null, d, d > 0 ? (p / d) * 100 : null];
          }),
          total: ['Jami', P, inRange.length, perHeadMonth, I, I > 0 ? (P / I) * 100 : null],
          note: "(!) — ish haqi odatdagidan 1,6 barobardan ko'p (ish haqi ikki marta kiritilgan bo'lishi mumkin — Xarajatlar bo'limida tekshiring).",
        },
      ],
    });

    // ─────────── Hududlar bo'yicha ───────────
    if (unit === 'all') {
      const byU = new Map<string, { pay: number; exp: number; inc: number }>();
      const get = (k: string) => {
        let x = byU.get(k);
        if (!x) {
          x = { pay: 0, exp: 0, inc: 0 };
          byU.set(k, x);
        }
        return x;
      };
      for (const r of expenses.filter(f)) {
        get(r.unit).exp += r.amount;
        if (r.source === 'PAYROLL') get(r.unit).pay += r.amount;
      }
      for (const r of inc) get(r.unit).inc += r.amount;
      const headsU = await this.data.headcountByUnit(range);
      const list = [...byU.entries()].filter(([, x]) => x.pay > 0 || x.inc > 0).sort((a, b) => unitOrder(a[0]) - unitOrder(b[0]) || b[1].pay - a[1].pay);
      sections.push({
        title: "Hududlar bo'yicha",
        intro: "«1 so'm ish haqiga daromad» — xodimlar mehnati samaradorligi (Markazda daromad kam bo'lishi tabiiy).",
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Hudud', width: 1.8 },
              { label: 'Ish haqi', format: 'money' },
              { label: 'Xodimlar', format: 'int', width: 0.7 },
              { label: '1 xodimga (davrda)', format: 'money' },
              { label: 'Xarajatdagi ulushi', format: 'pct', width: 0.8 },
              { label: "1 so'm ish haqiga daromad", format: 'decimal', width: 0.9 },
            ],
            rows: list.map(([k, x]) => {
              const h = headsU.get(k) ?? 0;
              return [labels.units.get(k) ?? k, x.pay, h, h > 0 ? x.pay / h : null, x.exp > 0 ? (x.pay / x.exp) * 100 : null, x.pay > 0 && x.inc > 0 ? x.inc / x.pay : null] as Cell[];
            }),
            total: ['Jami', P, inRange.length, inRange.length ? P / inRange.length : null, allExp > 0 ? (P / allExp) * 100 : null, P > 0 ? I / P : null],
          },
        ],
      });
    }

    // ─────────── Xodimlar tarkibi va harakati ───────────
    const types = { SHTAT: 'Asosiy shtat', SHARTNOMA: 'Shartnoma asosida' } as Record<string, string>;
    const byType = new Map<string, number>();
    for (const e of inRange) {
      const t = e.employmentType ? String(e.employmentType) : "Bandlik turi ko'rsatilmagan";
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const pos = new Map<string, number>();
    for (const e of inRange) {
      const p = e.position?.trim() || "Lavozim ko'rsatilmagan";
      pos.set(p, (pos.get(p) ?? 0) + 1);
    }
    const flow = months.map((m) => {
      const b = monthBounds(m);
      return [periodLabel(m), employees.filter((e) => e.hiredAt && e.hiredAt >= b.start && e.hiredAt < b.end).length, employees.filter((e) => e.firedAt && e.firedAt >= b.start && e.firedAt < b.end).length, worked(b).length] as Cell[];
    });
    sections.push({
      title: 'Xodimlar tarkibi va harakati',
      intro: "Xodimlar bo'limidan: ishga kirgan va bo'shagan sanalar bo'yicha.",
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Davrda ishlagan', value: String(inRange.length) },
            { label: 'Ishga kirgan', value: String(hired.length), tone: hired.length ? 'good' : 'neutral' },
            { label: "Bo'shagan", value: String(fired.length), tone: fired.length ? 'warn' : 'neutral' },
            { label: 'Kadrlar almashinuvi', value: fmtPct(avgHeads > 0 ? (fired.length / avgHeads) * 100 : null), sub: "bo'shaganlar / o'rtacha soni" },
          ],
        },
        {
          type: 'table',
          title: 'Oylar bo\'yicha harakat',
          columns: [{ label: 'Oy', width: 1.3 }, { label: 'Kirgan', format: 'int' }, { label: "Bo'shagan", format: 'int' }, { label: 'Ishlagan', format: 'int' }],
          rows: flow,
          total: ['Jami', hired.length, fired.length, inRange.length],
        },
        {
          type: 'table',
          title: 'Bandlik turi va lavozimlar',
          columns: [{ label: 'Guruh', width: 2.6 }, { label: 'Soni', format: 'int', width: 0.7 }, { label: 'Ulush', format: 'pct', width: 0.7 }],
          rows: [
            ...[...byType.entries()].map(([t, n]) => [types[t] ?? t, n, inRange.length ? (n / inRange.length) * 100 : null] as Cell[]),
            ...[...pos.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 15)
              .map(([p, n]) => [`   ${p}`, n, inRange.length ? (n / inRange.length) * 100 : null] as Cell[]),
          ],
        },
      ],
    });

    // ─────────── Ma'lumot sifati: takrorlangan ish haqi paketlari ───────────
    const quality: string[] = [];
    const flagged = months.filter((m) => med > 0 && (payM.get(m) ?? 0) > med * 1.6);
    if (flagged.length) quality.push(`Ish haqi odatdagidan ancha ko'p oylar: ${flagged.map((m) => `${periodLabel(m)} (${fmtSom(payM.get(m) ?? 0)}, odatda ${fmtSom(med)})`).join('; ')}.`);
    try {
      const batches = await this.prisma.payrollBatch.findMany({ where: { status: 'COMMITTED', period: { gte: months[0]!, lte: months[months.length - 1]! } }, select: { period: true, fileName: true, totalTiyin: true } });
      const perPeriod = new Map<string, typeof batches>();
      for (const b of batches) perPeriod.set(b.period, [...(perPeriod.get(b.period) ?? []), b]);
      for (const [p, list] of perPeriod) {
        if (list.length > 1) quality.push(`${periodLabel(p)}: ${list.length} ta tasdiqlangan ish haqi paketi (${list.map((b) => `${b.fileName} — ${fmtSom(Number(b.totalTiyin) / 100)}`).join('; ')}). Bittasi takror bo'lsa, Xarajatlar bo'limida bekor qiling.`);
      }
    } catch {
      /* paketlar jadvali bo'lmasa — o'tkazib yuboriladi */
    }
    if (quality.length) sections.push({ title: "Ma'lumot sifati", blocks: [{ type: 'notes', items: quality }] });

    // ─────────── Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${unitName}, ${rangeText(range)}: ish haqi xarajati ${fmtSom(P)}; o'tgan teng davrga nisbatan ${fmtSignedPct(cP)} (${signedSom(P - PP)}).`);
    if (perHeadMonth !== null) notes.push(`O'rtacha ${avgHeads.toFixed(0)} nafar xodim; bir xodimga oyiga ${fmtSom(perHeadMonth)} ish haqi xarajati.`);
    if (allExp > 0) notes.push(`Ish haqi barcha xarajatning ${fmtPct((P / allExp) * 100)} i${I > 0 ? `, daromadning ${fmtPct((P / I) * 100)} i` : ''}.`);
    notes.push(`Davrda ${hired.length} nafar ishga kirgan, ${fired.length} nafar bo'shagan.`);
    const cH = change(inRange.length, inPrev.length);
    if (inPrev.length && cH !== null && cP !== null) {
      const gap = cP - cH;
      notes.push(
        `Xodimlar soni o'tgan davrga nisbatan ${fmtSignedPct(cH)}, ish haqi xarajati ${fmtSignedPct(cP)} — ` +
          (Math.abs(gap) <= 3 ? "ikkalasi mutanosib o'zgarmoqda." : gap > 0 ? "ish haqi xodimlar sonidan tezroq o'smoqda (bir xodimga to'lov oshgan)." : "xodimlar soni ish haqidan tezroq o'smoqda (bir xodimga to'lov kamaygan yoki yangi xodimlar hali to'liq oylik olmagan)."),
      );
    }
    notes.push(...quality.slice(0, 2));
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Ish haqi va xodimlar',
      title: unit === 'all' ? 'Ish haqi va xodimlar' : `${unitName}: ish haqi va xodimlar`,
      subtitle: `${unitName} · ${rangeText(range)}`,
      meta: [`Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`, "Manba: Xarajatlar bo'limi (ish haqi yozuvlari) va Xodimlar bo'limi"],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Ish haqi va xodimlar - ${unitName} - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}