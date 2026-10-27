// 23106 › Xizmat safari: xarajatga o'tkazilgan yozuvlar (expense id → xodim) — hisobotlar uchun yengil o'qish.
// Solishtirma / Umumiy «Xizmat safari» moddasini alohida ko'rsatadi va ichida xodim → oylar bo'yicha ochadi.
// Saqlash: settings «acc23106.safar» (acc23106.safar.service.ts yozadi).

export const SAFAR_STORE_KEY = 'acc23106.safar';

export interface SafarExpenseMeta {
  fullName: string;
  pinfl: string | null;
  /** Xodim qayerda ishlagani (to'langan oyda): «Hududlar › Samarqand › Urgut» */
  placeLabel: string;
}

interface PrismaLike {
  setting: { findUnique: (a: { where: { key: string } }) => Promise<{ value: unknown } | null> };
}

/** Tasdiqlangan (bekor qilinmagan) xizmat safari xarajatlari: expense id → xodim */
export async function safarExpenseMeta(prisma: PrismaLike): Promise<Map<string, SafarExpenseMeta>> {
  const row = await prisma.setting.findUnique({ where: { key: SAFAR_STORE_KEY } }).catch(() => null);
  const posts = (row?.value as { posts?: unknown } | null)?.posts;
  const out = new Map<string, SafarExpenseMeta>();
  if (!Array.isArray(posts)) return out;
  for (const p of posts as { status?: string; items?: unknown }[]) {
    if (p?.status !== 'POSTED' || !Array.isArray(p.items)) continue;
    for (const it of p.items as { expenseId?: string; fullName?: string; pinfl?: string | null; place?: { label?: string } }[]) {
      if (it?.expenseId) out.set(it.expenseId, { fullName: it.fullName ?? '—', pinfl: it.pinfl ?? null, placeLabel: it.place?.label ?? '' });
    }
  }
  return out;
}

export const SAFAR_PART = { key: 'SAFAR', label: 'Xizmat safari' };
