import type { PrismaService } from '../prisma/prisma.service';
import { CENTRAL_REGION, periodDays } from './rd.util';

export interface RegionalEmployee {
  pinfl: string;
  fullName: string;
  regionCode: number;
  position: string | null;
  employmentType: string;
  hiredAt: Date | null;
  firedAt: Date | null;
}

type EmployeeRow = { pinfl: string; fullName: string; regionCode: number; position: string | null; employmentType: string; hiredAt: Date | null; firedAt: Date | null; isActive: boolean };

const EMPLOYEE_SELECT = { pinfl: true, fullName: true, regionCode: true, position: true, employmentType: true, hiredAt: true, firedAt: true, isActive: true } as const;

/** Bir oy: ishlagan hudud xodimlari (hududi — oy joyidan, bo'lmasa — xodim kartasidan); Markaz (0) kirmaydi */
function pickRegional(employees: EmployeeRow[], loc: Map<string, number>, period: string): RegionalEmployee[] {
  const { first, last } = periodDays(period);
  const monthStart = new Date(first.getTime() - 5 * 3600_000);
  const monthEnd = new Date(last.getTime() + 86_400_000 - 5 * 3600_000);
  return employees
    .filter((e) => {
      if (e.hiredAt && e.hiredAt >= monthEnd) return false;
      if (e.firedAt && e.firedAt < monthStart) return false;
      if (!e.hiredAt && !e.firedAt && !e.isActive) return false;
      return true;
    })
    .map((e) => ({
      pinfl: e.pinfl,
      fullName: e.fullName,
      regionCode: loc.get(e.pinfl) ?? e.regionCode,
      position: e.position,
      employmentType: e.employmentType,
      hiredAt: e.hiredAt,
      firedAt: e.firedAt,
    }))
    .filter((e) => e.regionCode !== CENTRAL_REGION);
}

/**
 * Shu oyda ishlagan hudud xodimlari: hududi — oy bo'yicha hudud tarixidan (bo'lmasa xodim kartasidan),
 * Markaz (0) kirmaydi; ishga kirgan/bo'shagan sanalar oy bilan kesishishi kerak.
 */
export async function regionalEmployees(prisma: PrismaService, period: string): Promise<RegionalEmployee[]> {
  return (await regionalEmployeesMany(prisma, [period])).get(period) ?? [];
}

/**
 * Bir necha oy uchun birdan (xuddi regionalEmployees kabi): xodimlar jadvali bir marta, oy joylari bitta so'rovda —
 * oyma-oy siklda har oy uchun butun jadvalni qayta o'qimaslik uchun.
 */
export async function regionalEmployeesMany(prisma: PrismaService, periods: string[]): Promise<Map<string, RegionalEmployee[]>> {
  const out = new Map<string, RegionalEmployee[]>();
  const list = [...new Set(periods)];
  if (!list.length) return out;
  const [employees, locations] = await Promise.all([
    prisma.employee.findMany({ select: EMPLOYEE_SELECT }),
    prisma.employeeLocation.findMany({ where: { period: { in: list } }, select: { employeePinfl: true, regionCode: true, period: true } }),
  ]);
  const byPeriod = new Map<string, Map<string, number>>(list.map((p) => [p, new Map()]));
  for (const l of locations) byPeriod.get(l.period)?.set(l.employeePinfl, l.regionCode);
  for (const p of list) out.set(p, pickRegional(employees, byPeriod.get(p)!, p));
  return out;
}
