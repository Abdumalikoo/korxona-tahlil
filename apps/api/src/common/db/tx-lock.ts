import { Prisma } from '@prisma/client';

/**
 * Tranzaksiya ichida kalit bo'yicha qulf (PostgreSQL advisory lock) — tranzaksiya tugaganda o'zi ochiladi.
 * Hujjat raqami («AR-2026-0042») hisoblashdan oldin olinadi: bir vaqtdagi ikki so'rov bir xil raqam olmaydi,
 * shuning uchun «raqam band» xatosi va qayta urinishlar kerak bo'lmaydi.
 * Bir nechta API nusxasida ham ishlaydi (qulf bazada).
 */
export async function lockInTx(tx: unknown, key: string): Promise<void> {
  const t = tx as { $executeRaw?: (q: Prisma.Sql) => Promise<number> };
  if (typeof t.$executeRaw !== 'function') return; // sinov uchun xotiradagi baza
  await t.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}