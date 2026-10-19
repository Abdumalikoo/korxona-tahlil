import { Prisma } from '@prisma/client';

/**
 * Bir vaqtda ikki so'rov bir xil raqam olsa (P2002) yoki Serializable tranzaksiya to'qnashsa (P2034) —
 * qisqa kutib qayta urinadi. Foydalanuvchi 500 xato ko'rmaydi.
 */
export async function withRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034');
      if (!retryable || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 60 * (i + 1)));
    }
  }
  throw last;
}

/** Bir vaqtda o'qib-yozish to'qnashuvlari ehtimoli bor joylar (to'lov, qabul, bekor qilish) uchun */
export const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 } as const;

/** Qator summasi (tiyin): qty × narx; xavfsiz butun son oralig'idan chiqsa — xato */
export function lineAmount(qty: number, price: bigint, label: string): bigint {
  const v = Math.round(qty * Number(price));
  if (!Number.isFinite(v) || v > 9_000_000_000_000_000) throw new RangeError(`${label}: qator summasi juda katta`);
  return BigInt(v);
}