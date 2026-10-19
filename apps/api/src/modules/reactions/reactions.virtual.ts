import type { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// "Virtual" yozuvlar — Daromad/Xarajat jadvalida alohida qator bo'lib turmaydigan, lekin
// shu jadvallardagi summalarning bir qismi bo'lgan miqdorlar:
//  • tuman ish haqi — viloyat ish haqi xarajati ichidan o'sha oy shu tumanda ishlagan xodimlar oyligi
//    (Solishtirma › Tuman bilan aynan bir xil qoida);
//  • xodim ish haqi — uning ish haqi (tasdiqlangan vedomostdan);
//  • xodim natijasi — Natijalar faylidagi fakt (daromadga qo'shilmaydi, muhokama uchun ko'rsatkich).
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;
const DAY_MS = 86_400_000;

export interface VirtualRow {
  id: string;
  date: Date;
  amount: bigint;
  label: string;
  place: string;
}

/** Oyning oxirgi kuni (Toshkent kuni boshi, UTC) — ish haqi va natijalar shu sana bilan yoziladi */
export function periodEndDate(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS - DAY_MS);
}

/** Tuman xodimlarining ish haqi (viloyat ish haqi xarajati ichidagi ulushi) */
export async function districtPayrollRows(
  prisma: PrismaService,
  districtId: string,
  range: { gte: Date; lt: Date },
  section?: 'DOIMIY' | 'BOSHQA',
): Promise<VirtualRow[]> {
  const district = await prisma.district.findUnique({ where: { id: districtId }, select: { regionCode: true, name: true } });
  if (!district) return [];
  const regionCode = district.regionCode;

  const expenses = await prisma.expense.findMany({
    where: { deletedAt: null, source: 'PAYROLL', regionCode, payrollBatchId: { not: null }, date: range, ...(section ? { section } : {}) },
    select: { id: true, date: true, payrollBatchId: true },
    orderBy: { date: 'asc' },
  });
  if (expenses.length === 0) return [];

  // Partiya → viloyat yozuvi sanasi (bir partiyada viloyatga bitta yozuv)
  const batchDate = new Map<string, Date>();
  for (const e of expenses) if (!batchDate.has(e.payrollBatchId!)) batchDate.set(e.payrollBatchId!, e.date);

  const entries = await prisma.payrollEntry.findMany({
    where: { batchId: { in: [...batchDate.keys()] }, deletedAt: null },
    select: { batchId: true, employeePinfl: true, period: true, totalTiyin: true },
  });
  const pinfls = [...new Set(entries.map((e) => e.employeePinfl))];
  const periods = [...new Set(entries.map((e) => e.period))];
  const [registry, locations] = await Promise.all([
    prisma.employee.findMany({
      where: { pinfl: { in: pinfls } },
      select: { pinfl: true, fullName: true, regionCode: true, districtId: true, employmentType: true },
    }),
    prisma.employeeLocation.findMany({
      where: { employeePinfl: { in: pinfls }, period: { in: periods } },
      select: { employeePinfl: true, period: true, regionCode: true, districtId: true, employmentType: true },
    }),
  ]);
  const person = new Map(registry.map((e) => [e.pinfl, e]));
  const location = new Map(locations.map((l) => [`${l.employeePinfl}:${l.period}`, l]));

  const rows: VirtualRow[] = [];
  for (const entry of entries) {
    const p = person.get(entry.employeePinfl);
    const loc = location.get(`${entry.employeePinfl}:${entry.period}`);
    const effRegion = loc?.regionCode ?? p?.regionCode;
    const effType = loc?.employmentType ?? p?.employmentType;
    const effDistrict = loc ? loc.districtId : (p?.districtId ?? null);
    if (effRegion !== regionCode || effType === 'SHARTNOMA' || effDistrict !== districtId) continue;
    if (entry.totalTiyin === 0n) continue;
    rows.push({
      id: `payroll:${entry.batchId}:${entry.employeePinfl}`,
      date: batchDate.get(entry.batchId!)!,
      amount: entry.totalTiyin,
      label: `Ish haqi — ${p?.fullName ?? entry.employeePinfl}`,
      place: district.name,
    });
  }
  return rows;
}

/** Xodimning ish haqi (tasdiqlangan vedomostlardan) */
export async function employeeSalaryRows(prisma: PrismaService, pinfl: string, range: { gte: Date; lt: Date }): Promise<VirtualRow[]> {
  const entries = await prisma.payrollEntry.findMany({
    where: { employeePinfl: pinfl, deletedAt: null, batch: { status: 'COMMITTED' } },
    select: { period: true, totalTiyin: true, batchId: true, employee: { select: { fullName: true } } },
  });
  return entries
    .map((e) => ({
      id: `salary:${e.batchId}:${pinfl}`,
      date: periodEndDate(e.period),
      amount: e.totalTiyin,
      label: `Ish haqi — ${e.employee.fullName}`,
      place: e.period,
    }))
    .filter((r) => r.date >= range.gte && r.date < range.lt && r.amount !== 0n);
}

/** Xodimning natijasi (Natijalar faylidagi fakt) */
export async function employeeResultRows(prisma: PrismaService, pinfl: string, range: { gte: Date; lt: Date }): Promise<VirtualRow[]> {
  const results = await prisma.employeeResult.findMany({
    where: { employeePinfl: pinfl, batch: { cancelledAt: null } },
    select: { id: true, period: true, factTiyin: true, employee: { select: { fullName: true } } },
  });
  return results
    .map((r) => ({
      id: `result:${r.id}`,
      date: periodEndDate(r.period),
      amount: r.factTiyin,
      label: `Natija (fakt) — ${r.employee.fullName}`,
      place: r.period,
    }))
    .filter((r) => r.date >= range.gte && r.date < range.lt && r.amount !== 0n);
}