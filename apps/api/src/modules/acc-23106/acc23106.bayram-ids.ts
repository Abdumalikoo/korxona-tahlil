// 23106 › Hudud xodimlari bayram pullari: tasdiqlangan oylar — ish haqini qayta guruhlash uchun yengil o'qish.
// Hudud xodimlari ish haqi tarkibida yo'q — ularning bayram puli yagona manbadan, 23106 ko'chirmasidan olinadi.
// Faqat foydalanuvchi TASDIQLAGAN oylar hisobga olinadi (acc23106.bayram.service.ts yozadi).
// Saqlash: settings «acc23106.bayram» — migratsiya kerak emas.

export const BAYRAM_STORE_KEY = 'acc23106.bayram';

export interface BayramItem {
  /** To'lov kaliti (to'lov oyi ichida, takror qatorlar «#n» bilan) */
  key: string;
  /** To'lov (ko'chirma) oyi */
  payMonth: string;
  docDate: string;
  docNo: string;
  pinfl: string;
  fullName: string;
  regionCode: number;
  districtId: string | null;
  amountTiyin: string;
}

export interface BayramPost {
  id: string;
  /** Hisoblangan oy — ish haqining shu oyidan ajratiladi */
  period: string;
  createdAt: string;
  createdBy: string;
  items: BayramItem[];
  totalTiyin: string;
  status: 'POSTED' | 'CANCELLED';
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface BayramStore {
  posts: BayramPost[];
}

interface PrismaLike {
  setting: { findUnique: (a: { where: { key: string } }) => Promise<{ value: unknown } | null> };
}

export function readBayram(raw: unknown): BayramStore {
  const v = (raw ?? {}) as Partial<BayramStore>;
  return { posts: Array.isArray(v.posts) ? (v.posts as BayramPost[]).filter((p) => p && typeof p.id === 'string' && typeof p.period === 'string' && Array.isArray(p.items)) : [] };
}

/** Shu oy tasdiqlangan hudud bayram pullari: xodim (PINFL) → summa */
export async function approvedBayram(prisma: PrismaLike, period: string): Promise<Map<string, bigint>> {
  const row = await prisma.setting.findUnique({ where: { key: BAYRAM_STORE_KEY } }).catch(() => null);
  const out = new Map<string, bigint>();
  for (const p of readBayram(row?.value ?? null).posts) {
    if (p.status !== 'POSTED' || p.period !== period) continue;
    for (const it of p.items) {
      let v: bigint;
      try {
        v = BigInt(it.amountTiyin);
      } catch {
        continue;
      }
      if (it.pinfl && v > 0n) out.set(it.pinfl, (out.get(it.pinfl) ?? 0n) + v);
    }
  }
  return out;
}
