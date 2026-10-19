// ═══════════════════════════════════════════════════════════
// Asosiy vositalar — sof hisob (bazadan mustaqil, testlanadi).
//
// Sarf (eskirish) — to'g'ri chiziqli: har oy qiymat ÷ xizmat muddati, xariddan KEYINGI oydan boshlab.
// Oxirgi oy qoldiqni oladi (jami sarf = qiymat, tiyin aniqligida).
// Hisobdan chiqarilsa — o'sha oy qolgan (sarflanmagan) qiymat to'liq sarfga o'tadi, keyin sarf yo'q.
// ═══════════════════════════════════════════════════════════

export const TASHKENT_MS = 5 * 3600_000;

/** Sana → "YYYY-MM" (Toshkent vaqti) */
export function periodOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return yb * 12 + mb - (ya * 12 + ma);
}

/** Oyning oxirgi kuni (Toshkent 00:00) */
export function periodEndDate(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - TASHKENT_MS - 86_400_000);
}

/** Oyning birinchi kuni (Toshkent 00:00) — sarf sanasi: joriy oy sarfi «Bu oy» davrida ham ko'rinadi */
export function periodStartDate(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}

export interface ScheduleInput {
  costTiyin: bigint;
  acquiredAt: Date;
  lifeMonths: number;
  disposedAt: Date | null;
}

/** Sarf jadvali: oy → summa (faqat `upto` oyigacha, shu oy ham) */
export function chargeSchedule(a: ScheduleInput, upto: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const cost = a.costTiyin;
  if (cost <= 0n) return out;
  const life = Math.max(1, Math.round(a.lifeMonths));
  const start = addMonths(periodOf(a.acquiredAt), 1);
  const disposed = a.disposedAt ? periodOf(a.disposedAt) : null;
  const monthly = cost / BigInt(life);
  let charged = 0n;
  for (let i = 0; i < life; i += 1) {
    const p = addMonths(start, i);
    if (p > upto) break;
    if (disposed && p >= disposed) break;
    const amount = i === life - 1 ? cost - charged : monthly;
    if (amount > 0n) out.set(p, amount);
    charged += amount;
  }
  // Hisobdan chiqarilgan oy: qolgan qiymat (xarid oyida chiqarilsa — to'liq qiymat)
  if (disposed && disposed <= upto && charged < cost) out.set(disposed, (out.get(disposed) ?? 0n) + (cost - charged));
  return out;
}

/** Holat: shu oy oxiriga yig'ilgan sarf va qoldiq qiymat */
export function bookValue(a: ScheduleInput, at: string): { accumulated: bigint; residual: bigint; monthly: bigint; endPeriod: string; charged: number } {
  const sched = chargeSchedule(a, at);
  let acc = 0n;
  for (const v of sched.values()) acc += v;
  const life = Math.max(1, Math.round(a.lifeMonths));
  return {
    accumulated: acc,
    residual: a.costTiyin - acc,
    monthly: a.costTiyin / BigInt(life),
    endPeriod: addMonths(addMonths(periodOf(a.acquiredAt), 1), life - 1),
    charged: sched.size,
  };
}