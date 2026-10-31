// ═══════════════════════════════════════════════════════════
// Xodim xarajatini foiz bilan bo'limlarga bo'lish (Xarajatlar tarkibiy tuzilishi): bir xodim ikki daromad keltiradigan
// yo'nalishda ishlasa — ish haqisi (va unga ergashadigan ijtimoiy soliq) foizlar bo'yicha bo'limlarga yoziladi.
// Tanlangan oydan boshlab (o'zgartirilguncha). Saqlash: settings «employee.splits» — migratsiya kerak emas.
// Ish haqini qayta guruhlashda qo'llanadi (payroll.service regroup) — xarajat yozuvlari haqiqiy bo'lim bilan yoziladi,
// hamma hisobot (Solishtirma, Bosh sahifa, Tahlil, soliqlar) o'zgarishsiz ergashadi.
// ═══════════════════════════════════════════════════════════

export const SPLITS_KEY = 'employee.splits';

export interface SplitPart {
  departmentId: string;
  /** Foiz (0–100, ikki kasr xonagacha); hamma qismlar yig'indisi — 100 */
  pct: number;
}

export interface EmployeeSplit {
  id: string;
  pinfl: string;
  fullName: string;
  /** Shu oydan boshlab (YYYY-MM) */
  from: string;
  /** Shu oygacha (shu oy ham; null — o'zgartirilguncha) */
  to: string | null;
  parts: SplitPart[];
  at: string;
  by: string;
}

export function readSplits(raw: unknown): EmployeeSplit[] {
  const list = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  return (list as EmployeeSplit[]).filter((s) => s && typeof s.pinfl === 'string' && typeof s.from === 'string' && Array.isArray(s.parts) && s.parts.length >= 2);
}

/** Shu oy amaldagi bo'linish (eng kech boshlangani) */
export function splitAt(list: EmployeeSplit[], pinfl: string, period: string): EmployeeSplit | null {
  let best: EmployeeSplit | null = null;
  for (const s of list) {
    if (s.pinfl !== pinfl || s.from > period || (s.to && s.to < period)) continue;
    if (!best || s.from > best.from) best = s;
  }
  return best;
}

/** Summani foizlar bo'yicha bo'lish — tiyin aniq (qoldiq eng katta ulushga), yig'indi o'zgarmaydi */
export function splitAmount(amount: bigint, parts: SplitPart[]): bigint[] {
  const bp = parts.map((p) => BigInt(Math.round(p.pct * 100)));
  const total = bp.reduce((s, x) => s + x, 0n);
  if (total <= 0n) return parts.map((_, i) => (i === 0 ? amount : 0n));
  const out = bp.map((w) => (amount * w) / total);
  let rest = amount - out.reduce((s, x) => s + x, 0n);
  let best = 0;
  bp.forEach((w, i) => {
    if (w > bp[best]!) best = i;
  });
  out[best]! += rest;
  rest = 0n;
  return out;
}
