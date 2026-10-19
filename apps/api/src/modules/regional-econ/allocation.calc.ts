// ═══════════════════════════════════════════════════════════
// Taqsimlash va nisbatlar — sof funksiyalar (bazaga bog'liq emas, testlanadi).
//
//   Ulush(i) = Drayver(i) / Σ Drayver(k)          (faqat musbat drayverlar)
//   Taqsimlangan(i) = Xarajat × Ulush(i)          (tiyinda, «eng katta qoldiq» usuli bilan yaxlitlanadi —
//                                                  bo'laklar yig'indisi har doim aynan xarajatga teng)
//   Drayverlar yig'indisi 0 bo'lsa — taqsimlanmaydi (Markazda qoladi, sababi ko'rsatiladi).
// ═══════════════════════════════════════════════════════════

export const DRIVERS = ['HEADCOUNT', 'FTE', 'PAYROLL_RECORDS', 'REVENUE', 'TRANSACTIONS', 'EQUAL', 'MANUAL'] as const;
export type Driver = (typeof DRIVERS)[number];
export const ROLES = ['SUPPORT', 'REVENUE', 'CORPORATE'] as const;
export type Role = (typeof ROLES)[number];

export const DRIVER_LABELS: Record<Driver, string> = {
  HEADCOUNT: 'Xodimlar soni',
  FTE: 'Shtat birligi (stavkalar)',
  PAYROLL_RECORDS: 'Ish haqi yozuvlari soni',
  REVENUE: 'Daromad ulushi',
  TRANSACTIONS: 'Hujjatlar (yozuvlar) soni',
  EQUAL: 'Teng (har hududga bir xil)',
  MANUAL: "Qo'lda kiritilgan (masalan, tekshiruvlar soni)",
};

export const ROLE_LABELS: Record<Role, string> = {
  SUPPORT: "Yordamchi — hududlarga taqsimlanadi",
  REVENUE: "Daromad keltiruvchi — o'z daromadi bilan Markazda",
  CORPORATE: 'Umumkorporativ — Markazda qoladi',
};

/** Xarajatni drayverlar bo'yicha bo'lish (tiyin, qoldiqsiz). Drayver yig'indisi 0 → bo'sh xarita */
export function allocate(amount: bigint, weights: Map<number, number>): Map<number, bigint> {
  const out = new Map<number, bigint>();
  const items = [...weights.entries()].filter(([, w]) => Number.isFinite(w) && w > 0);
  const total = items.reduce((s, [, w]) => s + w, 0);
  if (total <= 0 || amount === 0n) return out;
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  // Butun qism va qoldiqlar (ulushlarni 1e9 aniqlikda — BigInt bilan)
  const SCALE = 1_000_000_000n;
  const parts = items.map(([k, w]) => {
    const share = BigInt(Math.round((w / total) * 1e9));
    const exact = abs * share;
    return { k, base: exact / SCALE, rem: exact % SCALE };
  });
  let rest = abs - parts.reduce((s, p) => s + p.base, 0n);
  // Qolgan tiyinlar eng katta qoldiqli hududlarga (teng bo'lsa — kod tartibida)
  const order = [...parts].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.k - b.k));
  for (const p of order) out.set(p.k, p.base);
  let i = 0;
  while (rest > 0n && order.length) {
    const p = order[i % order.length]!;
    out.set(p.k, out.get(p.k)! + 1n);
    rest -= 1n;
    i++;
  }
  // Ulushlar yaxlitlanishi tufayli ortiqcha bo'lsa (kamdan-kam) — eng kattasidan ayiriladi
  while (rest < 0n && order.length) {
    const p = order[0]!;
    out.set(p.k, out.get(p.k)! - 1n);
    rest += 1n;
  }
  if (neg) for (const [k, v] of out) out.set(k, -v);
  return out;
}

/** a / b; b = 0 bo'lsa null (ekranda «—», sababi bilan) */
export function ratio(a: bigint | number, b: bigint | number): number | null {
  const bn = Number(b);
  if (!bn) return null;
  return Number(a) / bn;
}

/** O'sish: (joriy − oldingi) / |oldingi|; oldingi 0 bo'lsa null */
export function growth(cur: bigint | number, prev: bigint | number): number | null {
  const p = Number(prev);
  if (!p) return null;
  return (Number(cur) - p) / Math.abs(p);
}

export function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}