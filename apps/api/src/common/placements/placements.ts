import type { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Xodimning joylashuv davrlari — «shu oydan shu oygacha shu joyda (Markaz bo'limi yoki hudud), shu lavozimda».
 * Xodimlar bazasidagi bitta (doimiy) joy va natijalar faylidagi joydan ustun; shu oy qo'lda qilingan joy
 * o'zgarishi (ish haqi tarkibi) esa davrdan ham ustun. Saqlanishi — settings jadvalida (migratsiyasiz).
 */
export const PLACEMENTS_KEY = 'employee.placements';

export interface Placement {
  id: string;
  pinfl: string;
  /** Boshlanish oyi (YYYY-MM), shu oy ham kiradi */
  from: string;
  /** Tugash oyi (YYYY-MM), shu oy ham kiradi; null — hozirgacha */
  to: string | null;
  unit: 'CENTER' | 'REGION';
  /** Markaz bo'limi (unit = CENTER) */
  departmentId: string | null;
  /** Hudud: viloyat va tuman (unit = REGION) */
  regionCode: number | null;
  districtId: string | null;
  /** Shu davrdagi lavozim (bo'lmasa — Xodimlar bazasidagisi) */
  position: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Saqlangan qiymatdan — faqat to'g'ri yozuvlar (buzilgani o'tkazib yuboriladi) */
export function readPlacementsValue(raw: unknown): Placement[] {
  const items = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: Placement[] = [];
  for (const x of items) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const from = str(o.from);
    const to = str(o.to);
    const unit = o.unit === 'CENTER' || o.unit === 'REGION' ? o.unit : null;
    if (!str(o.id) || !str(o.pinfl) || !from || !PERIOD.test(from) || (to && (!PERIOD.test(to) || to < from)) || !unit) continue;
    out.push({
      id: str(o.id)!,
      pinfl: str(o.pinfl)!,
      from,
      to,
      unit,
      departmentId: unit === 'CENTER' ? str(o.departmentId) : null,
      regionCode: unit === 'REGION' && typeof o.regionCode === 'number' ? o.regionCode : null,
      districtId: unit === 'REGION' ? str(o.districtId) : null,
      position: str(o.position),
      note: str(o.note),
      createdAt: str(o.createdAt) ?? '',
      createdBy: str(o.createdBy) ?? '',
    });
  }
  return out;
}

export async function readPlacements(prisma: PrismaService): Promise<Placement[]> {
  const row = await prisma.setting.findUnique({ where: { key: PLACEMENTS_KEY } }).catch(() => null);
  return readPlacementsValue(row?.value ?? null);
}

/** Davr shu oyni qamraydimi */
export const covers = (p: Pick<Placement, 'from' | 'to'>, period: string) => p.from <= period && (!p.to || period <= p.to);

/** Xodimning shu oydagi davri (ustma-ust bo'lmaydi — qo'shishda tekshiriladi; bo'lsa — keyin boshlangani) */
export function placementAt(list: Placement[], pinfl: string, period: string): Placement | null {
  let best: Placement | null = null;
  for (const p of list) if (p.pinfl === pinfl && covers(p, period) && (!best || p.from > best.from)) best = p;
  return best;
}

/** Ikki davr kesishadimi (tugashi yo'q — cheksiz) */
export const overlaps = (a: Pick<Placement, 'from' | 'to'>, b: Pick<Placement, 'from' | 'to'>) => a.from <= (b.to ?? '9999-12') && b.from <= (a.to ?? '9999-12');
