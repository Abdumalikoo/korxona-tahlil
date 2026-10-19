import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { mln, unitOrder } from './report.common';
import { dayStart, daysIn, monthsOf, previousRange, rangeText, ReportData, todayIso, type Range } from './reports.data';
import { change, fmtPct, fmtSignedPct, fmtSom, grouped, PALETTE, periodLabel, periodShort, safeFile } from './reports.format';
import type { Cell, ReportDoc, ReportParams, ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Mashinalar va ijara.
// Jami summalar — Xarajatlar bo'limidagi mashina va ijara yozuvlaridan (o'chirilganlari kirmaydi);
// tafsilot (litr, probeg, m², ijaraga beruvchi) — shu yozuvlarni yaratgan Mashinalar va Ijara reestrlaridan.
// ═══════════════════════════════════════════════════════════

const DAY = 86_400_000;
const KIND: Record<string, string> = { FUEL: "Yoqilg'i", WASH: 'Moyka', REPAIR: "Ta'mirlash", SERVICE: 'Texnik xizmat', OTHER: 'Boshqa' };
const FUEL: Record<string, string> = { AI80: 'AI-80', AI92: 'AI-92', AI95: 'AI-95', DIZEL: 'Dizel', METAN: 'Metan', PROPAN: 'Propan', ELEKTR: 'Elektr' };

/**
 * Yoqilg'i sarfi (to'la bakdan to'la bakgacha usuli): spidometr ko'rsatilgan yoqilg'i yozuvlari probeg bo'yicha tartiblanadi,
 * probeg = oxirgi − birinchi ko'rsatkich; sarflangan litr = birinchisidan KEYINGI quyilishlar (birinchi quyilgan yoqilg'i
 * undan oldingi yo'lga ketgan). l/100 km = litr / probeg × 100. Kamida 2 ta shunday yozuv kerak.
 */
function consumption(fills: { odo: number; liters: number }[]): { km: number; liters: number; per100: number } | null {
  const list = fills.filter((f) => f.odo > 0).sort((a, b) => a.odo - b.odo);
  if (list.length < 2) return null;
  const km = list[list.length - 1]!.odo - list[0]!.odo;
  const liters = list.slice(1).reduce((s, f) => s + f.liters, 0);
  if (km <= 0 || liters <= 0) return null;
  return { km, liters, per100: (liters / km) * 100 };
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

@Injectable()
export class AssetsReport {
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
    const f = ReportData.inRange(range);
    const fp = ReportData.inRange(prev);
    const veh = expenses.filter((r) => f(r) && r.source === 'VEHICLE');
    const vehPrev = expenses.filter((r) => fp(r) && r.source === 'VEHICLE');
    const lease = expenses.filter((r) => f(r) && r.source === 'LEASE');
    const leasePrev = expenses.filter((r) => fp(r) && r.source === 'LEASE');
    const allExp = expenses.filter(f).reduce((s, r) => s + r.amount, 0);
    const V = veh.reduce((s, r) => s + r.amount, 0);
    const VP = vehPrev.reduce((s, r) => s + r.amount, 0);
    const L = lease.reduce((s, r) => s + r.amount, 0);
    const LP = leasePrev.reduce((s, r) => s + r.amount, 0);
    const months = monthsOf(range);
    const sections: ReportSection[] = [];
    const start = dayStart(range.from);
    const end = new Date(dayStart(range.to).getTime() + DAY);
    const unitOf = (code: number) => (code === 0 ? 'center' : `r:${code}`);

    // ─────────── Umumiy ───────────
    sections.push({
      title: "Umumiy ko'rinish",
      intro: `Solishtirish: o'tgan teng davr (${rangeText(prev)}).`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Mashinalar xarajati', value: fmtSom(V), sub: `o'tgan teng davrga ${fmtSignedPct(change(V, VP))}`, tone: (change(V, VP) ?? 0) > 3 ? 'bad' : 'neutral' },
            { label: 'Ijara xarajati', value: fmtSom(L), sub: `o'tgan teng davrga ${fmtSignedPct(change(L, LP))}`, tone: (change(L, LP) ?? 0) > 3 ? 'bad' : 'neutral' },
            { label: 'Jami xarajatdagi ulushi', value: fmtPct(allExp > 0 ? ((V + L) / allExp) * 100 : null), sub: `mashinalar ${fmtPct(allExp > 0 ? (V / allExp) * 100 : null)}, ijara ${fmtPct(allExp > 0 ? (L / allExp) * 100 : null)}` },
            { label: 'Oylik o\'rtacha', value: fmtSom((V + L) / Math.max(1, months.length)), sub: 'mashinalar + ijara' },
          ],
        },
        {
          type: 'chart',
          title: "Oylar bo'yicha",
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: months.map(periodShort),
          series: [
            { name: 'Mashinalar', values: months.map((m) => mln(veh.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0))), color: PALETTE.amber },
            { name: 'Ijara', values: months.map((m) => mln(lease.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0))), color: PALETTE.navy2 },
          ],
        },
      ],
    });

    // ─────────── Mashinalar ───────────
    const vehExpenseIds = new Set(
      (await this.prisma.expense.findMany({ where: { deletedAt: null, source: 'VEHICLE', date: { gte: start, lt: end } }, select: { id: true } })).map((e) => e.id),
    );
    const records = (
      await this.prisma.vehicleRecord.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end } },
        select: { kind: true, amountTiyin: true, liters: true, odometerKm: true, expenseId: true, vehicle: { select: { id: true, plateNumber: true, model: true, regionCode: true, driverName: true, fuelType: true, fuelNorm: true } } },
      })
    ).filter((r) => r.expenseId && vehExpenseIds.has(r.expenseId) && (unit === 'all' || unitOf(r.vehicle.regionCode) === unit));
    const perVeh = new Map<string, { v: (typeof records)[number]['vehicle']; total: number; fuel: number; liters: number; kinds: Map<string, number>; count: number; odo: number[]; fills: { odo: number; liters: number }[] }>();
    const byKind = new Map<string, number>();
    for (const r of records) {
      const amount = Number(r.amountTiyin) / 100;
      const x = perVeh.get(r.vehicle.id) ?? { v: r.vehicle, total: 0, fuel: 0, liters: 0, kinds: new Map<string, number>(), count: 0, odo: [], fills: [] };
      x.total += amount;
      x.count += 1;
      x.kinds.set(String(r.kind), (x.kinds.get(String(r.kind)) ?? 0) + amount);
      if (r.kind === 'FUEL') {
        x.fuel += amount;
        x.liters += r.liters ?? 0;
        if (r.odometerKm && r.liters) x.fills.push({ odo: r.odometerKm, liters: r.liters });
      }
      if (r.odometerKm) x.odo.push(r.odometerKm);
      perVeh.set(r.vehicle.id, x);
      byKind.set(String(r.kind), (byKind.get(String(r.kind)) ?? 0) + amount);
    }
    const vehList = [...perVeh.values()].sort((a, b) => b.total - a.total);
    const recordsTotal = vehList.reduce((s, x) => s + x.total, 0);
    const vehicleCount = vehList.length;
    const vehBlocks: ReportSection['blocks'] = [];
    if (vehList.length) {
      vehBlocks.push({
        type: 'chart',
        title: "Xarajat turlari",
        kind: 'barh',
        unit: "mln so'm",
        labels: [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => KIND[k] ?? k),
        series: [{ name: 'Xarajat', values: [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([, v]) => mln(v)), color: PALETTE.amber }],
      });
      vehBlocks.push({
        type: 'table',
        title: "Mashinalar bo'yicha",
        columns: [
          { label: 'Mashina', width: 1.9 },
          { label: 'Joyi', width: 1.1 },
          { label: 'Jami', format: 'money' },
          { label: "Yoqilg'i", format: 'money' },
          { label: 'Litr', format: 'int', width: 0.6 },
          { label: "1 l narxi", format: 'money', width: 0.7 },
          { label: "Ta'mir va xizmat", format: 'money' },
          { label: 'Probeg, km', format: 'int', width: 0.7 },
          { label: 'l/100 km', format: 'decimal', width: 0.6 },
        ],
        rows: vehList.map((x) => {
          const km = x.odo.length >= 2 ? Math.max(...x.odo) - Math.min(...x.odo) : null;
          const per100 = consumption(x.fills)?.per100 ?? null;
          return [
            `${x.v.plateNumber} · ${x.v.model}${x.v.fuelNorm && per100 && per100 > x.v.fuelNorm * 1.15 ? ' (!)' : ''}`,
            labels.units.get(unitOf(x.v.regionCode)) ?? String(x.v.regionCode),
            x.total,
            x.fuel,
            x.liters || null,
            x.liters > 0 ? x.fuel / x.liters : null,
            (x.kinds.get('REPAIR') ?? 0) + (x.kinds.get('SERVICE') ?? 0),
            km,
            per100,
          ] as Cell[];
        }),
        total: ['Jami', `${vehicleCount} ta`, recordsTotal, vehList.reduce((s, x) => s + x.fuel, 0), vehList.reduce((s, x) => s + x.liters, 0) || null, null, vehList.reduce((s, x) => s + (x.kinds.get('REPAIR') ?? 0) + (x.kinds.get('SERVICE') ?? 0), 0), null, null],
        note: "Probeg — davrdagi spidometr ko'rsatkichlari farqi. l/100 km — to'la bakdan to'la bakgacha: birinchi quyilishdan keyingi litrlar ÷ shu quyilishlar orasidagi probeg × 100. (!) — sarf me'yordan 15% dan ko'p.",
      });
      if (Math.abs(recordsTotal - V) > 1) {
        vehBlocks.push({ type: 'notes', items: [`Xarajatlar bo'limidagi mashina yozuvlari (${fmtSom(V)}) Mashinalar reestridagi yozuvlardan (${fmtSom(recordsTotal)}) farq qiladi — ba'zi xarajatlar reestrsiz kiritilgan bo'lishi mumkin.`] });
      }
    } else {
      vehBlocks.push({ type: 'notes', items: [V > 0 ? `Mashina xarajatlari ${fmtSom(V)}, lekin Mashinalar reestrida mos yozuvlar topilmadi.` : "Davrda mashina xarajatlari yo'q."] });
    }
    sections.push({ title: 'Mashinalar', intro: `${vehicleCount} ta mashina bo'yicha xarajat yozuvlari.`, blocks: vehBlocks });

    // ─────────── Ijara ───────────
    const leaseExpenseIds = new Set(
      (await this.prisma.expense.findMany({ where: { deletedAt: null, source: 'LEASE', date: { gte: start, lt: end } }, select: { id: true } })).map((e) => e.id),
    );
    const accruals = await this.prisma.leaseAccrual.findMany({ where: { expenseId: { in: [...leaseExpenseIds] } }, select: { leaseId: true, amountTiyin: true } });
    const perLease = new Map<string, number>();
    for (const a of accruals) perLease.set(a.leaseId, (perLease.get(a.leaseId) ?? 0) + Number(a.amountTiyin) / 100);
    const firstMonth = months[0]!;
    const lastMonth = months[months.length - 1]!;
    const leases = (
      await this.prisma.lease.findMany({
        where: { deletedAt: null },
        select: { id: true, number: true, title: true, kind: true, regionCode: true, lessorName: true, areaM2: true, startPeriod: true, endPeriod: true, airportName: true, terms: { select: { validFrom: true, monthlyTiyin: true }, orderBy: { validFrom: 'desc' } } },
      })
    ).filter((l) => (unit === 'all' || unitOf(l.regionCode) === unit) && l.startPeriod <= lastMonth && (!l.endPeriod || l.endPeriod >= firstMonth || perLease.has(l.id)));
    const current = todayIso().slice(0, 7);
    const monthly = (l: (typeof leases)[number]) => Number(l.terms.find((t) => t.validFrom <= current)?.monthlyTiyin ?? l.terms[l.terms.length - 1]?.monthlyTiyin ?? 0n) / 100;
    const active = leases.filter((l) => !l.endPeriod || l.endPeriod >= current);
    const area = active.reduce((s, l) => s + (l.areaM2 ?? 0), 0);
    const monthlyTotal = active.reduce((s, l) => s + monthly(l), 0);
    const withArea = active.filter((l) => l.areaM2 && l.areaM2 > 0);
    const expiring = active.filter((l) => l.endPeriod && l.endPeriod <= shiftMonth(current, 3)).sort((a, b) => (a.endPeriod ?? '').localeCompare(b.endPeriod ?? ''));
    const leaseRows = leases
      .map((l) => ({ l, amount: perLease.get(l.id) ?? 0, m: monthly(l) }))
      .sort((a, b) => unitOrder(unitOf(a.l.regionCode)) - unitOrder(unitOf(b.l.regionCode)) || b.amount - a.amount);
    const byRegion = new Map<string, { amount: number; count: number; area: number }>();
    for (const x of leaseRows) {
      const k = unitOf(x.l.regionCode);
      const y = byRegion.get(k) ?? { amount: 0, count: 0, area: 0 };
      y.amount += x.amount;
      y.count += 1;
      y.area += x.l.areaM2 ?? 0;
      byRegion.set(k, y);
    }
    sections.push({
      title: 'Ijara',
      intro: `Davrga tegishli ${leases.length} ta shartnoma; hozir amalda — ${active.length} ta.`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Amaldagi shartnomalar', value: String(active.length), sub: expiring.length ? `${expiring.length} tasi 3 oyda tugaydi` : undefined, tone: expiring.length ? 'warn' : 'neutral' },
            { label: 'Oylik ijara (hozir)', value: fmtSom(monthlyTotal) },
            { label: 'Umumiy maydon', value: area > 0 ? `${grouped(area)} m²` : '—' },
            { label: "1 m² o'rtacha narxi", value: withArea.length ? fmtSom(withArea.reduce((s, l) => s + monthly(l), 0) / withArea.reduce((s, l) => s + (l.areaM2 ?? 0), 0)) : '—', sub: 'oyiga' },
          ],
        },
        {
          type: 'table',
          title: 'Shartnomalar',
          columns: [
            { label: 'Obyekt', width: 2 },
            { label: 'Joyi', width: 1.1 },
            { label: 'Ijaraga beruvchi', width: 1.6 },
            { label: 'Davrda', format: 'money' },
            { label: 'Oylik (hozir)', format: 'money' },
            { label: 'm²', format: 'int', width: 0.5 },
            { label: "1 m² narxi", format: 'money', width: 0.8 },
            { label: 'Tugashi', width: 0.8 },
          ],
          rows: leaseRows.map(({ l, amount, m }) => [
            `${l.title}${l.kind === 'AEROPORT' && l.airportName ? ` (${l.airportName})` : ''} — №${l.number}`,
            labels.units.get(unitOf(l.regionCode)) ?? String(l.regionCode),
            l.lessorName,
            amount,
            m,
            l.areaM2 ? Math.round(l.areaM2) : null,
            l.areaM2 ? m / l.areaM2 : null,
            l.endPeriod ? periodLabel(l.endPeriod) : 'muddatsiz',
          ]),
          total: ['Jami', `${leases.length} ta`, null, leaseRows.reduce((s, x) => s + x.amount, 0), monthlyTotal, area ? Math.round(area) : null, null, null],
        },
        ...(unit === 'all' && byRegion.size > 1
          ? [
              {
                type: 'table' as const,
                title: "Hududlar bo'yicha",
                columns: [{ label: 'Hudud', width: 2 }, { label: 'Shartnomalar', format: 'int' as const, width: 0.8 }, { label: 'Davrda', format: 'money' as const }, { label: 'Maydon, m²', format: 'int' as const }],
                rows: [...byRegion.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([k, y]) => [labels.units.get(k) ?? k, y.count, y.amount, y.area ? Math.round(y.area) : null] as Cell[]),
              },
            ]
          : []),
      ],
    });

    // ─────────── Xulosalar ───────────
    const notes: string[] = [];
    notes.push(`${unitName}, ${rangeText(range)}: mashinalar xarajati ${fmtSom(V)} (${fmtSignedPct(change(V, VP))}), ijara ${fmtSom(L)} (${fmtSignedPct(change(L, LP))}).`);
    if (vehList[0]) notes.push(`Eng ko'p xarajat qilgan mashina — ${vehList[0].v.plateNumber} ${vehList[0].v.model}: ${fmtSom(vehList[0].total)}${vehicleCount ? `; o'rtacha bir mashinaga ${fmtSom(recordsTotal / vehicleCount)}` : ''}.`);
    const fuelTotal = vehList.reduce((s, x) => s + x.fuel, 0);
    const litersTotal = vehList.reduce((s, x) => s + x.liters, 0);
    if (litersTotal > 0) notes.push(`Yoqilg'i: ${grouped(Math.round(litersTotal))} litr, o'rtacha narx ${fmtSom(fuelTotal / litersTotal)} / litr; yoqilg'i mashina xarajatining ${fmtPct(recordsTotal > 0 ? (fuelTotal / recordsTotal) * 100 : null)} i.`);
    const over = vehList.filter((x) => {
      const c = consumption(x.fills);
      return Boolean(x.v.fuelNorm && c && c.per100 > x.v.fuelNorm * 1.15);
    });
    if (over.length) notes.push(`Yoqilg'i sarfi me'yordan 15% dan ko'p: ${over.map((x) => `${x.v.plateNumber} (${FUEL[String(x.v.fuelType)] ?? x.v.fuelType})`).join(', ')}.`);
    if (active.length) notes.push(`Ijara: ${active.length} ta amaldagi shartnoma, hozirgi oylik to'lov ${fmtSom(monthlyTotal)}${area ? `, ${grouped(area)} m²` : ''}.`);
    if (expiring.length) notes.push(`Yaqin 3 oyda tugaydigan shartnomalar: ${expiring.map((l) => `${l.title} (${periodLabel(l.endPeriod!)})`).join(', ')} — uzaytirish yoki yangi joy haqida qaror kerak.`);
    sections.push({ title: 'Xulosalar', blocks: [{ type: 'notes', items: notes }] });

    return {
      kind: 'Mashinalar va ijara',
      title: unit === 'all' ? 'Mashinalar va ijara' : `${unitName}: mashinalar va ijara`,
      subtitle: `${unitName} · ${rangeText(range)}`,
      meta: [`Davr: ${rangeText(range)} (${daysIn(range)} kun); solishtirish: ${rangeText(prev)}`, "Manba: Xarajatlar bo'limi (mashina va ijara yozuvlari), Mashinalar va Ijara reestrlari"],
      highlights: notes.slice(0, 6),
      sections,
      fileBase: safeFile(`Mashinalar va ijara - ${unitName} - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}