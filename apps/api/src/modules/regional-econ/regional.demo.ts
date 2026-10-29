import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRAL_REGION, currentPeriod, monthName, periodDays, shiftPeriod } from '../regional-data/rd.util';
import { CENTER_UNIT, PAYROLL_CATEGORY } from './econ.loader';
import { ForecastService } from './forecast.service';
import { KpiService } from './kpi.service';
import { PotentialService } from './potential.service';
import { REGION_GENERAL } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Hududlar modellari › Katta demo: 30 oylik to'liq namunaviy ma'lumot — barcha modellarni sinab ko'rish uchun.
//   Hududlar va ularning tumanlari (bazadagilar), 10 ta demo xizmat (mavsumiylik, trend, tarif o'zgarishi, uzilishlar),
//   hudud xodimlari (tumanlarga bo'lingan) va shtat kartalari, oylik vedomostlar, Natijalar fayli (reja/fakt/bonus), xarajatlar (takroriy va bir martalik), xarajat rejasi,
//   Markaz bo'limlari va taqsimlash qoidalari, voqealar jurnali, tariflar, KPI va saqlangan prognoz versiyasi.
// Hammasi haqiqiy yozuv bo'lib tushadi va belgilanadi: «[DEMO]» izoh/nom, SRV_DEMO_* xizmatlar, DEMO_* moddalar
// va bo'limlar, PINFL «99…». «Demoni o'chirish» — hammasi butunlay o'chadi, haqiqiy yozuvlarga tegilmaydi.
// ═══════════════════════════════════════════════════════════

export const DEMO = '[DEMO]';
const MONTHS = 30;
const PIN_PREFIX = '99';

const SERVICES: { code: string; label: string; price: number; qty: number; season: (m: number) => number }[] = [
  { code: 'SRV_DEMO_01', label: 'Soliq hisobotlarini tayyorlash', price: 150_000, qty: 420, season: (m) => ([1, 4, 7, 10].includes(m) ? 1.35 : 0.9) },
  { code: 'SRV_DEMO_02', label: 'Buxgalteriya xizmati (oylik)', price: 450_000, qty: 160, season: () => 1 },
  { code: 'SRV_DEMO_03', label: 'Yuridik shaxslarga maslahat', price: 120_000, qty: 300, season: (m) => (m === 12 ? 1.15 : m === 8 ? 0.85 : 1) },
  { code: 'SRV_DEMO_04', label: 'Jismoniy shaxslarga maslahat', price: 50_000, qty: 520, season: (m) => ([3, 4].includes(m) ? 1.4 : 0.95) },
  { code: 'SRV_DEMO_05', label: 'Elektron imzo kaliti', price: 90_000, qty: 260, season: () => 1 },
  { code: 'SRV_DEMO_06', label: 'Hisobot topshirish', price: 40_000, qty: 600, season: (m) => ([1, 4, 7, 10].includes(m) ? 1.3 : 0.92) },
  { code: 'SRV_DEMO_07', label: 'Audit oldi tekshiruv', price: 300_000, qty: 66, season: (m) => ([11, 12].includes(m) ? 1.5 : [1, 2].includes(m) ? 1.2 : 0.85) },
  { code: 'SRV_DEMO_08', label: "O'quv kurslari", price: 200_000, qty: 105, season: (m) => ([9, 10, 11].includes(m) ? 1.4 : [6, 7, 8].includes(m) ? 0.6 : 1) },
  { code: 'SRV_DEMO_09', label: "Deklaratsiya to'ldirish", price: 70_000, qty: 380, season: (m) => ([3, 4].includes(m) ? 2.1 : 0.8) },
  { code: 'SRV_DEMO_10', label: "Reestr ko'chirmasi", price: 25_000, qty: 700, season: () => 1 },
];

const OPEX = [
  { code: 'DEMO_RENT', label: 'Ijara' },
  { code: 'DEMO_UTIL', label: 'Kommunal xizmatlar' },
  { code: 'DEMO_NET', label: 'Internet va aloqa' },
  { code: 'DEMO_OFFICE', label: 'Ofis xarajatlari' },
  { code: 'DEMO_REPAIR', label: "Ta'mirlash (bir martalik)" },
];

const DEPTS = [
  { code: 'DEMO_BUX', name: 'Buxgalteriya', monthly: 60, role: 'SUPPORT', driver: 'PAYROLL_RECORDS', note: "ish haqi va hujjatlar soniga bog'liq" },
  { code: 'DEMO_IT', name: 'Axborot texnologiyalari', monthly: 45, role: 'SUPPORT', driver: 'HEADCOUNT', note: 'foydalanuvchilar (xodimlar) soni' },
  { code: 'DEMO_KADR', name: 'Kadrlar', monthly: 25, role: 'SUPPORT', driver: 'FTE', note: 'shtat birliklari' },
  { code: 'DEMO_YUR', name: "Yuridik bo'lim", monthly: 22, role: 'SUPPORT', driver: 'MANUAL', note: 'shartnomalar soni (qo\'lda)' },
  { code: 'DEMO_RAH', name: 'Rahbariyat', monthly: 70, role: 'CORPORATE', driver: null, note: 'butun korxona xarajati' },
  { code: 'DEMO_XIZ', name: 'Maxsus xizmatlar', monthly: 35, role: 'REVENUE', driver: null, note: "o'z daromadi bor" },
] as const;

const FIRST = ['Jasur', 'Bobur', 'Sardor', 'Akmal', 'Otabek', 'Shoxrux', 'Dilshod', "Ulug'bek", 'Aziz', 'Behzod', 'Sherzod', 'Farrux', 'Islom', 'Nodira', 'Dilnoza', 'Gulnora', 'Malika', 'Madina', 'Zarina', 'Feruza', 'Kamola', 'Sevara', 'Nilufar', 'Shahnoza'];
const LAST = ['Karimov', 'Toshmatov', 'Rahimov', 'Yusupov', 'Nazarov', 'Ergashev', 'Qodirov', 'Saidov', 'Mirzayev', 'Xolmatov', 'Abdullayev', 'Tursunov', 'Hasanov', 'Aliyev', 'Umarov', 'Sobirov', "Jo'rayev", 'Raximov', 'Ismoilov', 'Normatov'];
const SIZES = [2.4, 1.6, 1.5, 1.4, 1.3, 1.2, 1.2, 1.0, 0.9, 0.9, 0.8, 0.7, 0.6, 0.45];
/** Hudud kodi bo'yicha nisbiy hajm (rasmiy klassifikator); boshqa kodlar — tartib bo'yicha SIZES dan */
const SIZE_BY_CODE: Record<number, number> = { 26: 2.4, 27: 1.6, 18: 1.5, 30: 1.4, 3: 1.3, 14: 1.2, 10: 1.2, 22: 1.0, 1: 0.9, 6: 0.9, 33: 0.8, 12: 0.7, 8: 0.6, 24: 0.45 };

type Role = 'normal' | 'growth' | 'decline' | 'restructure' | 'jump' | 'raise' | 'overspend';
const ROLE_AT: Record<number, Role> = { 2: 'growth', 3: 'decline', 5: 'restructure', 7: 'jump', 9: 'raise', 11: 'overspend' };

/** Takrorlanadigan tasodifiy sonlar (har safar bir xil demo) */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const tiyin = (som: number) => BigInt(Math.round(som * 100));
const dayOf = (p: string, d: number) => new Date(`${p}-${String(d).padStart(2, '0')}T00:00:00Z`);
const lastDay = (p: string) => periodDays(p).last;

export interface DemoStatus {
  exists: boolean;
  incomes: number;
  expenses: number;
  employees: number;
  months: number;
  from: string | null;
  to: string | null;
  realRegionalIncomes: number;
}

@Injectable()
export class RegionalDemo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly forecasts: ForecastService,
    private readonly potentials: PotentialService,
    private readonly kpis: KpiService,
  ) {}

  private window() {
    const last = shiftPeriod(currentPeriod(), -1);
    const periods = Array.from({ length: MONTHS }, (_, i) => shiftPeriod(last, i - MONTHS + 1));
    return { last, periods, next: currentPeriod(), next2: shiftPeriod(currentPeriod(), 1) };
  }

  async status(): Promise<DemoStatus> {
    const { periods } = this.window();
    const codes = SERVICES.map((s) => s.code);
    const [incomes, expenses, employees, real, range] = await Promise.all([
      this.prisma.income.count({ where: { categoryCode: { in: codes } } }),
      this.prisma.expense.count({ where: { description: { startsWith: DEMO } } }),
      this.prisma.employee.count({ where: { pinfl: { startsWith: PIN_PREFIX }, fullName: { startsWith: DEMO } } }),
      this.prisma.income.count({ where: { deletedAt: null, period: { in: periods }, regionCode: { not: null, notIn: [CENTRAL_REGION] }, categoryCode: { notIn: codes } } }),
      this.prisma.income.findMany({ where: { categoryCode: 'SRV_DEMO_02' }, select: { period: true } }),
    ]);
    const ps = [...new Set(range.map((r) => r.period))].sort();
    return { exists: incomes > 0 || employees > 0, incomes, expenses, employees, months: ps.length, from: ps[0] ?? null, to: ps[ps.length - 1] ?? null, realRegionalIncomes: real };
  }

  async create(userId: string, force = false) {
    const st = await this.status();
    if (st.exists) throw new ConflictException('Demo allaqachon bor — avval o\'chiring');
    if (st.realRegionalIncomes > 0 && !force)
      throw new ConflictException({ message: `Hududlar bo'yicha ${st.realRegionalIncomes} ta haqiqiy daromad yozuvi bor — demo ular ustiga qo'shiladi va tahlil aralash bo'ladi. Baribir qo'shish uchun tasdiqlang.`, error: 'REAL_DATA' });
    const regions = await this.prisma.region.findMany({ where: { isActive: true, code: { notIn: [CENTRAL_REGION, REGION_GENERAL] } }, select: { code: true, name: true }, orderBy: { code: 'asc' } });
    if (!regions.length) throw new BadRequestException("Bazada faol hudud yo'q (regions jadvali)");
    const payrollCat = await this.prisma.category.findUnique({ where: { code: PAYROLL_CATEGORY } });
    if (!payrollCat) throw new BadRequestException(`Ish haqi moddasi (${PAYROLL_CATEGORY}) topilmadi`);
    try {
      const counts = await this.seed(userId, regions, st.realRegionalIncomes === 0);
      this.forecasts.clearCache();
      this.potentials.clearCache();
      const extra = await this.seedModels(userId);
      this.forecasts.clearCache();
      this.potentials.clearCache();
      await this.audit.log({ userId, action: 'CREATE', entity: 'regional_demo', entityId: 'demo', summary: `Hududlar katta demosi qo'shildi: ${counts.incomes} daromad, ${counts.expenses} xarajat, ${counts.employees} xodim` });
      return { ...counts, ...extra };
    } catch (e) {
      // Yarim qolgan demo qolmasin
      await this.remove(userId, true).catch(() => undefined);
      throw e;
    }
  }

  private async seed(userId: string, regions: { code: number; name: string }[], closeMonths: boolean) {
    const { last, periods, next, next2 } = this.window();
    const R = rng(20261013);
    const noise = (a: number) => 1 - a + 2 * a * R();

    // ── Ma'lumotnomalar ──
    await this.prisma.incomeCategory.createMany({ data: SERVICES.map((s, i) => ({ code: s.code, label: `${DEMO} ${s.label}`, isActive: true, order: 900 + i })) });
    await this.prisma.category.createMany({ data: OPEX.map((o, i) => ({ code: o.code, label: `${DEMO} ${o.label}`, isLeaf: true, isActive: true, order: 900 + i })) });
    const maxIdx = await this.prisma.department.aggregate({ _max: { index: true } });
    let idx = (maxIdx._max.index ?? 0) + 1;
    const depts: { id: string; code: string }[] = [];
    for (const d of DEPTS) {
      const row = await this.prisma.department.create({ data: { code: d.code, name: `${DEMO} ${d.name}`, index: idx++, isActive: true, order: 900 } });
      depts.push({ id: row.id, code: d.code });
    }
    const deptId = (code: string) => depts.find((d) => d.code === code)!.id;

    // ── Tariflar va voqealar ──
    const tariffStart = dayOf(periods[0]!, 1);
    const tariffChange = periods[24]!; // Elektron imzo: 6 oy oldin +15%
    const futureTariff = next2; // Soliq hisobotlari: keyingi oydan +10%
    await this.prisma.serviceTariff.createMany({
      data: [
        ...SERVICES.map((s) => ({ categoryCode: s.code, regionCode: null, priceTiyin: tiyin(s.price), validFrom: tariffStart, status: 'APPROVED', note: `${DEMO} Boshlang'ich tarif`, createdById: userId, decidedById: userId, decidedAt: tariffStart })),
        { categoryCode: 'SRV_DEMO_05', regionCode: null, priceTiyin: tiyin(90_000 * 1.15), validFrom: dayOf(tariffChange, 1), status: 'APPROVED', note: `${DEMO} Tannarx oshgani uchun`, createdById: userId, decidedById: userId, decidedAt: dayOf(tariffChange, 1) },
        { categoryCode: 'SRV_DEMO_01', regionCode: null, priceTiyin: tiyin(150_000 * 1.1), validFrom: dayOf(futureTariff, 1), status: 'APPROVED', note: `${DEMO} Yangi yildan oldin indeksatsiya`, createdById: userId, decidedById: userId, decidedAt: new Date() },
        { categoryCode: 'SRV_DEMO_10', regionCode: null, priceTiyin: tiyin(25_000 * 1.2), validFrom: dayOf(futureTariff, 1), status: 'PROPOSED', note: `${DEMO} Taklif: ko'chirma narxini oshirish`, createdById: userId, decidedById: null, decidedAt: null },
      ],
    });
    const priceOf = (code: string, p: string) => {
      const s = SERVICES.find((x) => x.code === code)!;
      if (code === 'SRV_DEMO_05' && p >= tariffChange) return s.price * 1.15;
      return s.price;
    };

    // ── Hudud profillari ──
    const prof = regions.map((r, i) => ({
      ...r,
      size: SIZE_BY_CODE[r.code] ?? SIZES[i % SIZES.length]!,
      role: (ROLE_AT[i] ?? 'normal') as Role,
      trend: ROLE_AT[i] === 'growth' ? 0.02 : ROLE_AT[i] === 'decline' ? -0.012 : 0.004 + 0.004 * R(),
      payFactor: i === 0 ? 1.25 : 1 - 0.15 * R(),
    }));
    // ── Tumanlar (bazadagi mavjud tumanlar; har viloyatda eng ko'pi 6 tasi) — Solishtirma ichkarisi uchun ──
    const dRows = await this.prisma.district.findMany({ where: { regionCode: { in: prof.map((p) => p.code) }, isActive: true }, select: { id: true, regionCode: true, code: true }, orderBy: { code: 'asc' } });
    const DW = [3, 1.6, 1.3, 1.1, 1, 0.9];
    const distOf = new Map<number, { id: string; w: number }[]>();
    for (const p of prof) {
      const ds = dRows.filter((d) => d.regionCode === p.code).sort((a, b) => a.code - b.code).slice(0, DW.length);
      const ws = ds.map((d, j) => ({ id: d.id, w: DW[j]! * (0.85 + 0.3 * R()) }));
      const tot = ws.reduce((a, x) => a + x.w, 0);
      distOf.set(p.code, ws.map((x) => ({ id: x.id, w: x.w / tot })));
    }
    /** Butun sonni ulushlarga bo'lish (eng katta qoldiq) */
    const splitInt = (n: number, ws: { id: string; w: number }[]) => {
      const raw = ws.map((x) => ({ id: x.id, v: n * x.w }));
      const out = raw.map((x) => ({ id: x.id, n: Math.floor(x.v), r: x.v - Math.floor(x.v) }));
      let rest = n - out.reduce((a, x) => a + x.n, 0);
      for (const x of [...out].sort((a, b) => b.r - a.r)) {
        if (rest <= 0) break;
        x.n += 1;
        rest -= 1;
      }
      return out.filter((x) => x.n > 0);
    };
    const pickDistrict = (code: number): string | null => {
      const ws = distOf.get(code) ?? [];
      if (!ws.length) return null;
      let u = R();
      for (const x of ws) {
        u -= x.w;
        if (u <= 0) return x.id;
      }
      return ws[ws.length - 1]!.id;
    };
    /** Tuman bo'yicha oylik daromad (Natijalar faylidagi reja uchun) */
    const distRevenue = new Map<string, number>();

    const restructureAt = 22;
    const jumpAt = 20;
    const restructure = prof.find((p) => p.role === 'restructure');
    const events: { date: Date; kind: string; regionCode: number | null; categoryCode: string | null; title: string; description: string; isBreak: boolean; createdById: string }[] = [
      { date: dayOf(tariffChange, 1), kind: 'TARIFF', regionCode: null, categoryCode: 'SRV_DEMO_05', title: `${DEMO} Yangi tarif: Elektron imzo kaliti +15%`, description: 'Tasdiqlangan tarif o\'zgarishi', isBreak: true, createdById: userId },
      { date: dayOf(periods[26]!, 10), kind: 'OTHER', regionCode: null, categoryCode: null, title: `${DEMO} Soliq kodeksiga o'zgartirishlar`, description: 'Maslahatlarga talab oshishi kutilmoqda (uzilish emas)', isBreak: false, createdById: userId },
    ];
    if (restructure) events.push({ date: dayOf(periods[restructureAt]!, 1), kind: 'RESTRUCTURE', regionCode: restructure.code, categoryCode: null, title: `${DEMO} Filial kengaytirildi — yangi bino va 4 xodim`, description: "Daromad darajasi taxminan 35% oshdi", isBreak: true, createdById: userId });
    await this.prisma.analysisEvent.createMany({ data: events });

    // ── Daromadlar ──
    const incomes: Record<string, unknown>[] = [];
    for (const p of prof) {
      periods.forEach((per, t) => {
        const m = Number(per.slice(5));
        let level = p.size * (1 + p.trend) ** t;
        if (p.role === 'restructure' && t >= restructureAt) level *= 1.35;
        for (const s of SERVICES) {
          let q = s.qty * 0.35 * level * s.season(m) * noise(0.06);
          if (p.role === 'jump' && s.code === 'SRV_DEMO_02' && t >= jumpAt) q *= 1.5;
          // Tarif oshganda talab biroz kamayadi (elastiklik ≈ −0,3)
          if (s.code === 'SRV_DEMO_05' && per >= tariffChange) q *= 0.955;
          const qty = Math.max(1, Math.round(q));
          const price = priceOf(s.code, per);
          const ds = distOf.get(p.code) ?? [];
          const parts = ds.length ? splitInt(qty, ds) : [{ id: null as string | null, n: qty }];
          for (const part of parts) {
            const amount = part.n * price;
            incomes.push({ date: lastDay(per), period: per, amountTiyin: tiyin(amount), paidTiyin: tiyin(amount), categoryCode: s.code, regionCode: p.code, districtId: part.id, quantity: part.n, description: `${DEMO} ${s.label}`, source: 'IMPORT', createdById: userId });
            const key = `${per}|${part.id ?? p.code}`;
            distRevenue.set(key, (distRevenue.get(key) ?? 0) + amount);
          }
        }
      });
    }
    // Markaz «Maxsus xizmatlar» bo'limining o'z daromadi
    periods.forEach((per) => incomes.push({ date: lastDay(per), period: per, amountTiyin: tiyin(55_000_000 * noise(0.08)), paidTiyin: 0n, categoryCode: 'SRV_DEMO_03', regionCode: CENTRAL_REGION, departmentId: deptId('DEMO_XIZ'), quantity: null, description: `${DEMO} Markaz maxsus xizmatlari`, source: 'IMPORT', createdById: userId }));
    for (let i = 0; i < incomes.length; i += 1000) await this.prisma.income.createMany({ data: incomes.slice(i, i + 1000) as never });

    // ── Xodimlar va shtat kartalari ──
    let pinSeq = 1;
    const emps: { pinfl: string; region: number; district?: string | null; base: number; rate: number; card: boolean; hired: Date | null; fired: Date | null; pos: string }[] = [];
    for (const p of prof) {
      const n = Math.round(8 * p.size * (p.role === 'decline' ? 1.35 : 1)) + 2;
      for (let k = 0; k < n; k++) {
        const pos = k === 0 ? 'Hudud rahbari' : k <= 2 ? 'Bosh mutaxassis' : k % 5 === 4 ? 'Operator' : 'Mutaxassis';
        const mult = k === 0 ? 1.8 : k <= 2 ? 1.3 : k % 5 === 4 ? 0.8 : 1;
        emps.push({ pinfl: `${PIN_PREFIX}${String(pinSeq++).padStart(12, '0')}`, region: p.code, base: 5_000_000 * p.payFactor * mult, rate: k % 7 === 6 ? 0.5 : 1, card: k % 6 !== 5, hired: dayOf(shiftPeriod(periods[0]!, -12 - k), 1), fired: null, pos });
      }
      // Kadrlar almashinuvi: biri 17-oyda ketgan, o'rniga 19-oyda yangi
      emps[emps.length - 1]!.fired = dayOf(periods[16]!, 15);
      emps.push({ pinfl: `${PIN_PREFIX}${String(pinSeq++).padStart(12, '0')}`, region: p.code, base: 4_600_000 * p.payFactor, rate: 1, card: true, hired: dayOf(periods[18]!, 1), fired: null, pos: 'Mutaxassis' });
      if (p.role === 'restructure') for (let k = 0; k < 4; k++) emps.push({ pinfl: `${PIN_PREFIX}${String(pinSeq++).padStart(12, '0')}`, region: p.code, base: 5_000_000 * p.payFactor, rate: 1, card: true, hired: dayOf(periods[restructureAt]!, 1), fired: null, pos: 'Mutaxassis' });
      if (p.role === 'raise') emps.push({ pinfl: `${PIN_PREFIX}${String(pinSeq++).padStart(12, '0')}`, region: p.code, base: 5_200_000 * p.payFactor, rate: 1, card: true, hired: dayOf(next2, 1), fired: null, pos: 'Mutaxassis (yangi shtat)' });
    }
    // Tuman: hudud rahbari — markaziy tumanda, qolganlari tumanlar hajmiga qarab
    for (const e of emps) e.district = e.pos === 'Hudud rahbari' ? (distOf.get(e.region)?.[0]?.id ?? null) : pickDistrict(e.region);
    // Kelgusida bo'shaydigan xodim (prognozda ko'rinadi)
    const leaver = emps.find((e) => e.region === prof[4 % prof.length]!.code && !e.fired && e.pos === 'Mutaxassis');
    if (leaver) leaver.fired = dayOf(next, 20);
    await this.prisma.employee.createMany({
      data: emps.map((e, i) => {
        const first = FIRST[i % FIRST.length]!;
        const lastName = LAST[(i * 7) % LAST.length]!;
        const female = ['Nodira', 'Dilnoza', 'Gulnora', 'Malika', 'Madina', 'Zarina', 'Feruza', 'Kamola', 'Sevara', 'Nilufar', 'Shahnoza'].includes(first);
        const ln = female ? `${lastName}a` : lastName;
        return { pinfl: e.pinfl, lastName: ln, firstName: first, fullName: `${DEMO} ${ln} ${first}`, employmentType: 'SHTAT' as const, regionCode: e.region, districtId: e.district ?? null, position: e.pos, hiredAt: e.hired, firedAt: e.fired, isActive: !e.fired || e.fired > new Date() };
      }),
    });
    const cards: Record<string, unknown>[] = [];
    for (const e of emps) {
      if (!e.card) continue;
      cards.push({ employeePinfl: e.pinfl, effectiveFrom: e.hired ?? dayOf(periods[0]!, 1), rate: e.rate, baseSalaryTiyin: tiyin(e.base), position: e.pos, note: DEMO, source: 'DEMO', createdById: userId });
      const p = prof.find((x) => x.code === e.region)!;
      if (p.role === 'raise' && (!e.hired || e.hired < dayOf(next2, 1))) cards.push({ employeePinfl: e.pinfl, effectiveFrom: dayOf(next2, 1), rate: e.rate, baseSalaryTiyin: tiyin(e.base * 1.2), position: e.pos, note: `${DEMO} Maosh +20%`, source: 'DEMO', createdById: userId });
    }
    await this.prisma.employeeSalary.createMany({ data: cards as never });

    // ── Vedomostlar (har oy) va ish haqi xarajatlari ──
    let entriesN = 0;
    let resultsN = 0;
    const expenses: Record<string, unknown>[] = [];
    for (const per of periods) {
      const start = dayOf(per, 1);
      const end = new Date(lastDay(per).getTime() + 86_400_000);
      const m = Number(per.slice(5));
      const active = emps.filter((e) => (!e.hired || e.hired < end) && (!e.fired || e.fired >= start));
      const rows = active.map((e) => {
        const bonus = [3, 6, 9, 12].includes(m) ? 1.25 : 1;
        const total = e.base * e.rate * 1.12 * bonus * noise(0.03);
        return { employeePinfl: e.pinfl, period: per, baseTiyin: tiyin(e.base * e.rate), bonusTiyin: tiyin(total - e.base * e.rate), totalTiyin: tiyin(total), region: e.region };
      });
      const sum = rows.reduce((s, r) => s + r.totalTiyin, 0n);
      const batch = await this.prisma.payrollBatch.create({
        data: { period: per, status: 'COMMITTED', scope: 'REGIONS', fileName: `${DEMO} Hududlar vedomosti ${per}.xlsx`, fileHash: `demo-${per}`, totalRows: rows.length, matchedRows: rows.length, totalTiyin: sum, uploadedById: userId, committedAt: lastDay(per) },
      });
      await this.prisma.payrollEntry.createMany({ data: rows.map(({ region: _r, ...x }) => ({ ...x, batchId: batch.id })) });
      entriesN += rows.length;
      const byRegion = new Map<number, bigint>();
      for (const r of rows) byRegion.set(r.region, (byRegion.get(r.region) ?? 0n) + r.totalTiyin);
      for (const [code, amt] of byRegion) expenses.push({ date: lastDay(per), period: per, amountTiyin: amt, categoryCode: PAYROLL_CATEGORY, regionCode: code, description: `${DEMO} Ish haqi (vedomost)`, source: 'PAYROLL', payrollBatchId: batch.id, createdById: userId });

      // Natijalar fayli (reja / fakt / bonus) — xodimning tumandagi ulushi bo'yicha; daromadga qo'shilmaydi
      const perDistrict = new Map<string, number>();
      for (const e of active) perDistrict.set(`${e.district ?? e.region}`, (perDistrict.get(`${e.district ?? e.region}`) ?? 0) + 1);
      const res = active.map((e) => {
        const key = `${e.district ?? e.region}`;
        const rev = distRevenue.get(`${per}|${key}`) ?? 0;
        const plan = (rev / (perDistrict.get(key) ?? 1)) * (e.pos === 'Hudud rahbari' ? 1.2 : e.pos === 'Operator' ? 0.7 : 1) * 0.95;
        const fact = plan * (0.82 + 0.33 * R());
        // Bonus: rejani bajarsa — faktning 3% + oshirib bajargan qismining 10%; 95%+ bajarsa — 1%
        const bonus = fact >= plan ? fact * 0.03 + (fact - plan) * 0.1 : fact >= plan * 0.95 ? fact * 0.01 : 0;
        return { employeePinfl: e.pinfl, period: per, regionCode: e.region, districtId: e.district ?? null, employmentType: 'SHTAT', planTiyin: tiyin(plan), factTiyin: tiyin(fact), bonusTiyin: tiyin(bonus) };
      });
      const rb = await this.prisma.resultBatch.create({
        data: { period: per, fileName: `${DEMO} Natijalar ${per}.xlsx`, totalRows: res.length, planTiyin: res.reduce((a, r) => a + r.planTiyin, 0n), factTiyin: res.reduce((a, r) => a + r.factTiyin, 0n), bonusTiyin: res.reduce((a, r) => a + r.bonusTiyin, 0n), uploadedById: userId },
      });
      await this.prisma.employeeResult.createMany({ data: res.map((r) => ({ ...r, batchId: rb.id })) });
      resultsN += res.length;
    }

    // ── Hudud xarajatlari ──
    periods.forEach((per, t) => {
      const m = Number(per.slice(5));
      for (const p of prof) {
        const k = p.size * (p.role === 'decline' ? 1.3 : 1) * (p.role === 'overspend' && t >= MONTHS - 3 ? 1.3 : 1);
        // Tumanlar bo'lsa — har tuman ofisiga ulushi bo'yicha; bir martalik — bitta tumanga
        const ds = distOf.get(p.code) ?? [];
        const add = (code: string, som: number, recurrence: 'RECURRING' | 'ONE_TIME') => {
          const parts = recurrence === 'ONE_TIME' || !ds.length ? [{ id: recurrence === 'ONE_TIME' ? pickDistrict(p.code) : null, w: 1 }] : ds;
          for (const part of parts)
            expenses.push({ date: dayOf(per, 15), period: per, amountTiyin: tiyin(som * part.w), categoryCode: code, regionCode: p.code, districtId: part.id, description: `${DEMO} ${OPEX.find((o) => o.code === code)!.label}`, source: 'MANUAL', recurrence, createdById: userId });
        };
        add('DEMO_RENT', 12_000_000 * k, 'RECURRING');
        add('DEMO_UTIL', 4_000_000 * k * ([12, 1, 2].includes(m) ? 1.5 : 1) * noise(0.08), 'RECURRING');
        add('DEMO_NET', 1_500_000 * k, 'RECURRING');
        add('DEMO_OFFICE', 2_000_000 * k * noise(0.25), 'RECURRING');
        if (R() < 0.12) add('DEMO_REPAIR', (8_000_000 + 17_000_000 * R()) * p.size, 'ONE_TIME');
      }
      // Markaz bo'limlari (ish haqi va boshqa), bo'limsiz Markaz va biriktirilmagan
      for (const d of DEPTS) {
        const v = d.monthly * 1_000_000 * noise(0.05);
        expenses.push({ date: lastDay(per), period: per, amountTiyin: tiyin(v * 0.75), categoryCode: PAYROLL_CATEGORY, regionCode: CENTRAL_REGION, departmentId: deptId(d.code), description: `${DEMO} ${d.name} — ish haqi`, source: 'PAYROLL', createdById: userId });
        expenses.push({ date: dayOf(per, 15), period: per, amountTiyin: tiyin(v * 0.25), categoryCode: 'DEMO_OFFICE', regionCode: CENTRAL_REGION, departmentId: deptId(d.code), description: `${DEMO} ${d.name} — xarajatlar`, source: 'MANUAL', recurrence: 'RECURRING', createdById: userId });
      }
      expenses.push({ date: dayOf(per, 5), period: per, amountTiyin: tiyin(40_000_000), categoryCode: 'DEMO_RENT', regionCode: CENTRAL_REGION, description: `${DEMO} Bosh ofis ijarasi`, source: 'MANUAL', recurrence: 'RECURRING', createdById: userId });
      expenses.push({ date: dayOf(per, 20), period: per, amountTiyin: tiyin(8_000_000 * ([12, 1, 2].includes(m) ? 1.5 : 1)), categoryCode: 'DEMO_UTIL', regionCode: CENTRAL_REGION, description: `${DEMO} Bosh ofis kommunal`, source: 'MANUAL', recurrence: 'RECURRING', createdById: userId });
      if (t >= MONTHS - 2) expenses.push({ date: dayOf(per, 25), period: per, amountTiyin: tiyin(1_500_000), categoryCode: 'DEMO_OFFICE', regionCode: null, description: `${DEMO} Hujjatsiz xarid (hudud/bo'lim ko'rsatilmagan)`, source: 'MANUAL', recurrence: 'ONE_TIME', createdById: userId });
    });
    for (let i = 0; i < expenses.length; i += 1000) await this.prisma.expense.createMany({ data: expenses.slice(i, i + 1000) as never });

    // ── Xarajat rejasi: oxirgi 3 oy va keyingi 2 oy (ish haqisiz moddalar) ──
    const planPeriods = [...periods.slice(-3), next, next2];
    const budgets: Record<string, unknown>[] = [];
    for (const per of planPeriods) {
      const m = Number(per.slice(5));
      for (const p of prof) {
        const k = p.size * (p.role === 'decline' ? 1.3 : 1);
        budgets.push(
          { period: per, regionCode: p.code, categoryCode: 'DEMO_RENT', amountTiyin: tiyin(12_000_000 * k), updatedById: userId },
          { period: per, regionCode: p.code, categoryCode: 'DEMO_UTIL', amountTiyin: tiyin(4_000_000 * k * ([12, 1, 2].includes(m) ? 1.5 : 1)), updatedById: userId },
          { period: per, regionCode: p.code, categoryCode: 'DEMO_NET', amountTiyin: tiyin(1_500_000 * k), updatedById: userId },
          { period: per, regionCode: p.code, categoryCode: 'DEMO_OFFICE', amountTiyin: tiyin(2_000_000 * k), updatedById: userId },
        );
      }
    }
    await this.prisma.expenseBudget.createMany({ data: budgets as never });

    // ── Taqsimlash qoidalari va qo'lda drayver ──
    const centerRule = await this.prisma.overheadRule.findFirst({ where: { unitKey: CENTER_UNIT } });
    await this.prisma.overheadRule.createMany({
      data: [
        // IT: qoida tarixi — avval teng bo'lingan, 6 oy oldin xodimlar soniga o'tilgan
        ...DEPTS.map((d) => ({ unitKey: deptId(d.code), role: d.role, driver: d.driver, validFrom: d.code === 'DEMO_IT' ? periods[24]! : periods[0]!, note: `${DEMO} ${d.note}`, createdById: userId })),
        { unitKey: deptId('DEMO_IT'), role: 'SUPPORT', driver: 'EQUAL', validFrom: periods[0]!, note: `${DEMO} Avvalgi qoida: hududlarga teng`, createdById: userId },
        ...(centerRule ? [] : [{ unitKey: CENTER_UNIT, role: 'SUPPORT', driver: 'HEADCOUNT', validFrom: periods[0]!, note: `${DEMO} Bino va kommunal — xodimlar soni bo'yicha`, createdById: userId }]),
      ],
    });
    const manual: Record<string, unknown>[] = [];
    for (const per of periods) for (const p of prof) manual.push({ period: per, unitKey: deptId('DEMO_YUR'), regionCode: p.code, value: Math.round(20 * p.size * noise(0.3)), updatedById: userId });
    await this.prisma.overheadDriverValue.createMany({ data: manual as never });

    // ── Oyni yopish: oxirgi oydan oldingi oylar (haqiqiy hudud ma'lumoti bo'lmasa — aks holda haqiqiy oylarni bloklamaslik uchun yopilmaydi) ──
    let closed = 0;
    if (closeMonths) {
      const existing = new Set((await this.prisma.regionalPeriodClose.findMany({ where: { period: { in: periods } }, select: { period: true } })).map((c) => c.period));
      const toClose = periods.slice(0, -1).filter((p) => !existing.has(p));
      if (toClose.length) await this.prisma.regionalPeriodClose.createMany({ data: toClose.map((p) => ({ period: p, status: 'CLOSED', closedAt: new Date(lastDay(p).getTime() + 5 * 86_400_000), closedById: userId, snapshot: { demo: true, note: DEMO } })) });
      closed = toClose.length;
    }

    return { regions: prof.length, districts: [...distOf.values()].reduce((a, x) => a + x.length, 0), incomes: incomes.length, expenses: expenses.length, employees: emps.length, payrollEntries: entriesN, results: resultsN, months: periods.length, from: periods[0]!, to: last, closedMonths: closed };
  }

  /** KPI va prognoz versiyasi — modellarning o'zi hisoblaydi (demo ma'lumot ustida) */
  private async seedModels(userId: string) {
    const { last } = this.window();
    const cur = currentPeriod();
    const kpiPeriods = [shiftPeriod(last, -2), shiftPeriod(last, -1), last, cur];
    const before = new Set((await this.prisma.kpiTarget.findMany({ where: { period: { in: kpiPeriods } }, select: { id: true } })).map((x) => x.id));
    let kpi = 0;
    for (const per of kpiPeriods) {
      await this.kpis.generate(per, userId);
      const rows = (await this.prisma.kpiTarget.findMany({ where: { period: per } })).filter((r) => !before.has(r.id));
      let i = 0;
      for (const r of rows) {
        i++;
        if (per !== cur) {
          // O'tgan oylar: ba'zilari model taklifidan yuqoriroq maqsad bilan
          if (r.metric === 'REVENUE' && i % 4 === 1) await this.kpis.propose(r.id, { valueTiyin: String((r.suggestedTiyin * 105n) / 100n), note: `${DEMO} Rahbariyat maqsadi: taklifdan 5% yuqori` }, userId);
          await this.kpis.approve(r.id, {}, userId);
        } else if (i % 3 === 0) await this.kpis.approve(r.id, {}, userId);
        else if (i % 3 === 1) await this.kpis.propose(r.id, { valueTiyin: String(r.suggestedTiyin), note: null }, userId);
        await this.prisma.kpiTarget.update({ where: { id: r.id }, data: { note: `${DEMO} ${r.note ?? 'Namuna KPI'}`.slice(0, 500) } });
        kpi++;
      }
    }
    await this.forecasts.saveRun(shiftPeriod(last, -3), 3, `${DEMO} ${monthName(shiftPeriod(last, -3))} oxiridagi rasmiy prognoz`, userId);
    await this.forecasts.saveRun(shiftPeriod(last, -1), 3, `${DEMO} Oxirgi prognoz`, userId);
    return { kpiTargets: kpi, forecastRuns: 2 };
  }

  /** Demoni butunlay o'chirish (faqat demo belgilari bilan; haqiqiy yozuvlarga tegilmaydi) */
  async remove(userId: string, quiet = false) {
    const codes = SERVICES.map((s) => s.code);
    const opex = OPEX.map((o) => o.code);
    const depts = await this.prisma.department.findMany({ where: { code: { in: DEPTS.map((d) => d.code) } }, select: { id: true } });
    const deptIds = depts.map((d) => d.id);
    const batches = await this.prisma.payrollBatch.findMany({ where: { fileName: { startsWith: DEMO } }, select: { id: true } });
    const batchIds = batches.map((b) => b.id);
    const pins = (await this.prisma.employee.findMany({ where: { pinfl: { startsWith: PIN_PREFIX }, fullName: { startsWith: DEMO } }, select: { pinfl: true } })).map((e) => e.pinfl);
    const n: Record<string, number> = {};
    const kpiIds = (await this.prisma.kpiTarget.findMany({ where: { note: { startsWith: DEMO } }, select: { id: true } })).map((k) => k.id);
    if (kpiIds.length) await this.prisma.kpiTargetLog.deleteMany({ where: { targetId: { in: kpiIds } } });
    n.kpi = (await this.prisma.kpiTarget.deleteMany({ where: { id: { in: kpiIds } } })).count;
    n.runs = (await this.prisma.forecastRun.deleteMany({ where: { note: { startsWith: DEMO } } })).count;
    n.drivers = (await this.prisma.overheadDriverValue.deleteMany({ where: { unitKey: { in: deptIds } } })).count;
    n.rules = (await this.prisma.overheadRule.deleteMany({ where: { OR: [{ note: { startsWith: DEMO } }, { unitKey: { in: deptIds } }] } })).count;
    n.budgets = (await this.prisma.expenseBudget.deleteMany({ where: { categoryCode: { in: opex } } })).count;
    n.entries = batchIds.length ? (await this.prisma.payrollEntry.deleteMany({ where: { batchId: { in: batchIds } } })).count : 0;
    n.expenses = (await this.prisma.expense.deleteMany({ where: { OR: [{ description: { startsWith: DEMO } }, { categoryCode: { in: opex } }, ...(batchIds.length ? [{ payrollBatchId: { in: batchIds } }] : []), ...(deptIds.length ? [{ departmentId: { in: deptIds } }] : [])] } })).count;
    n.batches = batchIds.length ? (await this.prisma.payrollBatch.deleteMany({ where: { id: { in: batchIds } } })).count : 0;
    n.incomes = (await this.prisma.income.deleteMany({ where: { OR: [{ categoryCode: { in: codes } }, ...(deptIds.length ? [{ departmentId: { in: deptIds } }] : [])] } })).count;
    const rbs = (await this.prisma.resultBatch.findMany({ where: { fileName: { startsWith: DEMO } }, select: { id: true } })).map((b) => b.id);
    n.results = rbs.length ? (await this.prisma.employeeResult.deleteMany({ where: { batchId: { in: rbs } } })).count : 0;
    if (rbs.length) await this.prisma.resultBatch.deleteMany({ where: { id: { in: rbs } } });
    n.salaries = pins.length ? (await this.prisma.employeeSalary.deleteMany({ where: { employeePinfl: { in: pins } } })).count : 0;
    n.employees = pins.length ? (await this.prisma.employee.deleteMany({ where: { pinfl: { in: pins } } })).count : 0;
    n.tariffs = (await this.prisma.serviceTariff.deleteMany({ where: { categoryCode: { in: codes } } })).count;
    n.events = (await this.prisma.analysisEvent.deleteMany({ where: { title: { startsWith: DEMO } } })).count;
    const closes = await this.prisma.regionalPeriodClose.findMany({ select: { id: true, snapshot: true } });
    const demoCloses = closes.filter((c) => (c.snapshot as { demo?: boolean } | null)?.demo === true).map((c) => c.id);
    n.closes = demoCloses.length ? (await this.prisma.regionalPeriodClose.deleteMany({ where: { id: { in: demoCloses } } })).count : 0;
    await this.prisma.incomeCategory.deleteMany({ where: { code: { in: codes } } });
    await this.prisma.category.deleteMany({ where: { code: { in: opex } } });
    if (deptIds.length) await this.prisma.department.deleteMany({ where: { id: { in: deptIds } } });
    this.forecasts.clearCache();
    this.potentials.clearCache();
    if (!quiet) await this.audit.log({ userId, action: 'DELETE', entity: 'regional_demo', entityId: 'demo', summary: `Hududlar demosi o'chirildi: ${n.incomes} daromad, ${n.expenses} xarajat, ${n.employees} xodim` });
    return n;
  }
}