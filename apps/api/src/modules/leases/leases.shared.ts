import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { CENTRAL_REGION, VAT_PERCENT, type LeasePlace, type LeaseStatus } from './leases.types';

// ═══════════════════════════════════════════════════════════
// Ijara — umumiy yordamchilar (servislar orasida bo'lishiladi)
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD_RE.test(value);
}

export function assertPeriod(value: unknown, label: string): string {
  if (!isPeriod(value)) throw new BadRequestException(`${label} noto'g'ri (YYYY-MM)`);
  return value;
}

/** Joriy oy — Toshkent vaqti bilan */
export function currentPeriod(): string {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "2026-01" → "2026-02" */
export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** "2026-02" → "2026-01" */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Oylar oralig'i (ikkala chet ham kiradi) */
export function periodsBetween(from: string, to: string): string[] {
  const result: string[] = [];
  for (let p = from; p <= to && result.length < 600; p = nextPeriod(p)) result.push(p);
  return result;
}

/** Tiyin satrini BigInt'ga — manfiy va noto'g'ri qiymat rad etiladi */
export function parseTiyin(value: unknown, label = 'Summa'): bigint {
  let result: bigint;
  try {
    result = BigInt(String(value ?? '').trim());
  } catch {
    throw new BadRequestException(`${label} noto'g'ri`);
  }
  if (result < 0n) throw new BadRequestException(`${label} manfiy bo'lishi mumkin emas`);
  return result;
}

/** Summa ichidagi QQS (12%) */
export function vatOf(amount: bigint): bigint {
  return (amount * VAT_PERCENT + (100n + VAT_PERCENT) / 2n) / (100n + VAT_PERCENT);
}

export interface TermLike {
  validFrom: string;
  monthlyTiyin: bigint;
}

export interface LeaseRange {
  startPeriod: string;
  endPeriod: string | null;
}

export function statusFor(lease: LeaseRange, period: string): LeaseStatus {
  if (period < lease.startPeriod) return 'NOT_STARTED';
  if (lease.endPeriod && period > lease.endPeriod) return 'ENDED';
  return 'ACTIVE';
}

/**
 * Berilgan oy uchun oylik summa: shu oygacha kuchga kirgan eng oxirgi narx.
 * Ijara shu oyda amalda bo'lmasa — 0.
 */
export function amountFor(lease: LeaseRange, terms: TermLike[], period: string): bigint {
  if (statusFor(lease, period) !== 'ACTIVE') return 0n;
  let amount = 0n;
  let best = '';
  for (const term of terms) {
    if (term.validFrom <= period && term.validFrom >= best) {
      best = term.validFrom;
      amount = term.monthlyTiyin;
    }
  }
  return amount;
}

// ═══════════ Joy nomlari ═══════════

export interface Lookups {
  regions: Map<number, string>;
  districts: Map<string, { name: string; regionCode: number }>;
  departments: Map<string, string>;
}

export async function loadLookups(prisma: PrismaService): Promise<Lookups> {
  const [regions, districts, departments] = await Promise.all([
    prisma.region.findMany({ select: { code: true, name: true } }),
    prisma.district.findMany({ select: { id: true, name: true, regionCode: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    regions: new Map(regions.map((r) => [r.code, r.name])),
    districts: new Map(districts.map((d) => [d.id, { name: d.name, regionCode: d.regionCode }])),
    departments: new Map(departments.map((d) => [d.id, d.name])),
  };
}

export function buildPlace(
  lease: {
    kind: string;
    regionCode: number;
    districtId: string | null;
    departmentId: string | null;
    airportName: string | null;
  },
  lookups: Lookups,
): LeasePlace {
  const regionName =
    lookups.regions.get(lease.regionCode) ??
    (lease.regionCode === CENTRAL_REGION ? 'Markaz' : `Hudud ${lease.regionCode}`);
  const districtName = lease.districtId
    ? (lookups.districts.get(lease.districtId)?.name ?? lease.districtId)
    : null;
  const departmentName = lease.departmentId
    ? (lookups.departments.get(lease.departmentId) ?? null)
    : null;

  let label: string;
  if (lease.kind === 'AEROPORT') {
    label = lease.airportName ? `${lease.airportName} (${regionName})` : `${regionName} aeroporti`;
  } else if (lease.regionCode === CENTRAL_REGION) {
    label = departmentName ? `${regionName} · ${departmentName}` : regionName;
  } else {
    label = districtName ? `${regionName} · ${districtName}` : regionName;
  }

  return {
    regionCode: lease.regionCode,
    regionName,
    districtId: lease.districtId,
    districtName,
    departmentId: lease.departmentId,
    departmentName,
    airportName: lease.airportName,
    label,
  };
}
