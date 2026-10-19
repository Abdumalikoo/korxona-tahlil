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

/**
 * Shu oyda ishlagan hudud xodimlari: hududi — oy bo'yicha hudud tarixidan (bo'lmasa xodim kartasidan),
 * Markaz (0) kirmaydi; ishga kirgan/bo'shagan sanalar oy bilan kesishishi kerak.
 */
export async function regionalEmployees(prisma: PrismaService, period: string): Promise<RegionalEmployee[]> {
  const { first, last } = periodDays(period);
  const monthStart = new Date(first.getTime() - 5 * 3600_000);
  const monthEnd = new Date(last.getTime() + 86_400_000 - 5 * 3600_000);
  const [employees, locations] = await Promise.all([
    prisma.employee.findMany({
      select: { pinfl: true, fullName: true, regionCode: true, position: true, employmentType: true, hiredAt: true, firedAt: true, isActive: true },
    }),
    prisma.employeeLocation.findMany({ where: { period }, select: { employeePinfl: true, regionCode: true } }),
  ]);
  const loc = new Map(locations.map((l) => [l.employeePinfl, l.regionCode]));
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