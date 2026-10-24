import type { PrismaService } from '../prisma/prisma.service';
import { loadCenterCategories, loadPolicyRouting } from '../expense-policy/policy.util';
import { regionalEmployees } from '../regional-data/rd.employees';
import { CENTRAL_REGION, periodDays } from '../regional-data/rd.util';

// ═══════════════════════════════════════════════════════════
// Hudud natijasi va Markaz xarajati uchun oylik ma'lumot (faqat bazadagi yozuvlardan, hech narsa to'qilmaydi).
//
// Yozuv qaysi birlikka tegishli (Solishtirma va Katta modellar bilan bir xil):
//   hudud kodi ≠ 0                → shu hudud;
//   hudud kodi = 0 yoki bo'sh, bo'lim bor → Markaz › shu bo'lim;
//   hudud kodi = 0, bo'lim yo'q      → Markaz › «Bo'limsiz» (CENTER);
//   hudud ham, bo'lim ham yo'q       → «Biriktirilmagan» (UNASSIGNED).
// Oy — yozuvning «period» maydoni (u yozuv sanasidan olinadi).
// Ish haqi — Xarajatlardagi source = PAYROLL yozuvlari; qolgani — operatsion xarajat.
// ═══════════════════════════════════════════════════════════

export const CENTER_UNIT = 'CENTER';
/** Ish haqi xarajati moddasi (rejada ham shu kod bilan) */
export const PAYROLL_CATEGORY = 'PAYROLL_BASE';
export const UNASSIGNED_UNIT = 'UNASSIGNED';

export interface UnitMoney {
  income: bigint;
  expense: bigint;
  payroll: bigint;
  count: number;
}

export interface RegionMonth {
  revenue: bigint;
  payroll: bigint;
  opex: bigint;
  incomeCount: number;
  expenseCount: number;
  headcount: number;
  fte: number;
  /** Shtat jadvalida stavkasi yo'q xodimlar (FTE da 1 deb olindi) */
  fteMissing: number;
  payrollRecords: number;
  /** Shu oy uchun xarajat rejasi (null — reja kiritilmagan) */
  budget: bigint | null;
  /** Reja kiritilgan moddalar bo'yicha fakt (reja va fakt bir xil moddalarda solishtiriladi) */
  budgetFact: bigint | null;
  /** Modda bo'yicha fakt (ish haqi — PAYROLL_BASE ga) */
  factByCategory: Map<string, bigint>;
}

export interface MonthData {
  period: string;
  regions: Map<number, RegionMonth>;
  /** Markaz birliklari (bo'limlar, CENTER) va UNASSIGNED */
  units: Map<string, UnitMoney>;
  /** MANUAL drayver qiymatlari: unitKey → (hudud → qiymat) */
  manual: Map<string, Map<number, number>>;
}

export interface Lookups {
  regions: { code: number; name: string }[];
  departments: { id: string; code: string; name: string; isActive: boolean }[];
}

export function unitOf(regionCode: number | null, departmentId: string | null): { region: number } | { unit: string } {
  if (regionCode !== null && regionCode !== undefined && regionCode !== CENTRAL_REGION) return { region: regionCode };
  if (departmentId) return { unit: departmentId };
  if (regionCode === CENTRAL_REGION) return { unit: CENTER_UNIT };
  return { unit: UNASSIGNED_UNIT };
}

export async function loadLookups(prisma: PrismaService): Promise<Lookups> {
  const [regions, departments] = await Promise.all([
    prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
    prisma.department.findMany({ select: { id: true, code: true, name: true, isActive: true }, orderBy: { index: 'asc' } }),
  ]);
  return { regions, departments };
}

const emptyRegion = (): RegionMonth => ({ revenue: 0n, payroll: 0n, opex: 0n, incomeCount: 0, expenseCount: 0, headcount: 0, fte: 0, fteMissing: 0, payrollRecords: 0, budget: null, budgetFact: null, factByCategory: new Map() });
const emptyUnit = (): UnitMoney => ({ income: 0n, expense: 0n, payroll: 0n, count: 0 });

/** Bir nechta oy ma'lumoti (oylar tartibda qaytadi) */
export async function loadMonths(prisma: PrismaService, periods: string[], lookups: Lookups): Promise<MonthData[]> {
  if (!periods.length) return [];
  const centerCategories = await loadCenterCategories(prisma);
  // Yo'nalishlar (Tax free …) — alohida bo'limlar: hududlar modeliga kirmaydi, «biriktirilmagan» ham emas;
  // faqat siyosat bo'yicha Markaz hisobiga o'tganlari Markaz xarajatiga qo'shiladi
  const routing = await loadPolicyRouting(prisma).catch(() => null);
  const [incomes, expenses, salaries, batches, budgets, manual] = await Promise.all([
    prisma.income.findMany({ where: { deletedAt: null, period: { in: periods }, segment: null }, select: { period: true, regionCode: true, departmentId: true, amountTiyin: true } }),
    prisma.expense.findMany({ where: { deletedAt: null, period: { in: periods } }, select: { period: true, regionCode: true, departmentId: true, amountTiyin: true, source: true, categoryCode: true, segment: true } }),
    prisma.employeeSalary.findMany({ select: { employeePinfl: true, effectiveFrom: true, rate: true }, orderBy: { effectiveFrom: 'asc' } }),
    prisma.payrollBatch.findMany({ where: { period: { in: periods }, status: 'COMMITTED' }, select: { id: true, period: true } }),
    prisma.expenseBudget.findMany({ where: { period: { in: periods } }, select: { period: true, regionCode: true, amountTiyin: true, categoryCode: true } }),
    prisma.overheadDriverValue.findMany({ where: { period: { in: periods } }, select: { period: true, unitKey: true, regionCode: true, value: true } }),
  ]);
  const entries = batches.length
    ? await prisma.payrollEntry.findMany({ where: { deletedAt: null, batchId: { in: batches.map((b) => b.id) } }, select: { employeePinfl: true, period: true } })
    : [];

  const salaryByPin = new Map<string, { from: Date; rate: number }[]>();
  for (const s of salaries) {
    const list = salaryByPin.get(s.employeePinfl) ?? [];
    list.push({ from: new Date(s.effectiveFrom), rate: s.rate });
    salaryByPin.set(s.employeePinfl, list);
  }

  const out: MonthData[] = [];
  for (const period of periods) {
    const m: MonthData = { period, regions: new Map(), units: new Map(), manual: new Map() };
    for (const r of lookups.regions) m.regions.set(r.code, emptyRegion());
    const region = (code: number) => {
      let x = m.regions.get(code);
      if (!x) m.regions.set(code, (x = emptyRegion()));
      return x;
    };
    const unit = (key: string) => {
      let x = m.units.get(key);
      if (!x) m.units.set(key, (x = emptyUnit()));
      return x;
    };

    for (const i of incomes) {
      if (i.period !== period) continue;
      const u = unitOf(i.regionCode, i.departmentId);
      if ('region' in u) {
        const r = region(u.region);
        r.revenue += i.amountTiyin;
        r.incomeCount += 1;
      } else {
        const x = unit(u.unit);
        x.income += i.amountTiyin;
        x.count += 1;
      }
    }
    for (const e of expenses) {
      if (e.period !== period) continue;
      // Xarajatlar siyosati: Markaz hisobidagi moddalar (bayram puli, komandirovka …) — Markazga
      if (e.segment) {
        if (routing?.route(e)?.key !== 'center') continue;
      }
      const u = e.segment || centerCategories.has(e.categoryCode) ? unitOf(CENTRAL_REGION, null) : unitOf(e.regionCode, e.departmentId);
      const isPayroll = e.source === 'PAYROLL';
      if ('region' in u) {
        const r = region(u.region);
        if (isPayroll) r.payroll += e.amountTiyin;
        else r.opex += e.amountTiyin;
        r.expenseCount += 1;
        const cat = isPayroll ? PAYROLL_CATEGORY : e.categoryCode;
        r.factByCategory.set(cat, (r.factByCategory.get(cat) ?? 0n) + e.amountTiyin);
      } else {
        const x = unit(u.unit);
        x.expense += e.amountTiyin;
        if (isPayroll) x.payroll += e.amountTiyin;
        x.count += 1;
      }
    }

    // Xodimlar: oy ichida ishlagan hudud xodimlari; FTE — oy oxiridagi stavka (shtat jadvalidan)
    const staff = await regionalEmployees(prisma, period);
    const monthEnd = periodDays(period).last;
    const pinRegion = new Map<string, number>();
    for (const e of staff) {
      pinRegion.set(e.pinfl, e.regionCode);
      const r = region(e.regionCode);
      r.headcount += 1;
      const hist = salaryByPin.get(e.pinfl) ?? [];
      let rate: number | null = null;
      for (const h of hist) if (h.from <= monthEnd) rate = h.rate;
      if (rate === null) {
        r.fte += 1;
        r.fteMissing += 1;
      } else r.fte += rate;
    }
    for (const p of entries) {
      if (p.period !== period) continue;
      const code = pinRegion.get(p.employeePinfl);
      if (code !== undefined) region(code).payrollRecords += 1;
    }
    const planned = new Map<number, Set<string>>();
    for (const b of budgets) {
      if (b.period !== period || b.regionCode === CENTRAL_REGION) continue;
      const r = region(b.regionCode);
      r.budget = (r.budget ?? 0n) + b.amountTiyin;
      const set = planned.get(b.regionCode) ?? new Set<string>();
      set.add(b.categoryCode);
      planned.set(b.regionCode, set);
    }
    for (const [code, set] of planned) {
      const r = region(code);
      let f = 0n;
      for (const c of set) f += r.factByCategory.get(c) ?? 0n;
      r.budgetFact = f;
    }
    for (const v of manual) {
      if (v.period !== period) continue;
      const map = m.manual.get(v.unitKey) ?? new Map<number, number>();
      map.set(v.regionCode, v.value);
      m.manual.set(v.unitKey, map);
    }
    out.push(m);
  }
  return out;
}