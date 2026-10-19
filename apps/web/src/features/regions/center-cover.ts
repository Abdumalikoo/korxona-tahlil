// ═══════════════════════════════════════════════════════════
// Markazni qoplash — sof hisob (ekrandan mustaqil, tekshiriladi).
//
// Markaz sof xarajati M = Markaz xarajati − Markaz daromadi. U hududlar foydasidan qoplanadi.
//
// 1) Teng taqsim:  har hududga M ÷ n (n — faol hududlar). Oddiy, lekin foydasi kichik hudud zararga tushishi mumkin.
// 2) Optimal (eng yaxshi) qoplash — «imkon qadar teng»:
//    hamma hududga bir xil ulush λ beriladi; foydasi λ dan kam hudud faqat o'z foydasini beradi (zararga
//    tushmaydi), yetmagan qism foydasi yetarli hududlarga yana teng bo'linadi. λ shunday tanlanadiki,
//    Σ min(foyda_i, λ) = M. Zarardagi hudud (foyda ≤ 0) hech narsa bermaydi.
//    • Hududlar foydasi M dan katta bo'lsa — Markaz 100% qoplanadi, har hudud ulushidan ortgan foyda —
//      «ortiqcha», u korxona foydasiga yo'naltiriladi.
//    • Kichik bo'lsa — hamma hudud bor foydasini beradi, yetishmovchilik (M − Σ foyda) ko'rsatiladi.
// Bu usul eng ko'p hududni zararsiz qoldiradi va yukni eng tekis taqsimlaydi (maksimal ulush minimal bo'ladi).
// ═══════════════════════════════════════════════════════════

export interface CoverInput {
  key: string;
  /** Hudud kodi (tumanlarga ochish uchun) */
  code?: number | null;
  name: string;
  income: number;
  profit: number;
}

export interface CoverRow extends CoverInput {
  /** Teng taqsimdagi ulush (M ÷ n) */
  equalShare: number;
  /** Teng taqsimdan keyingi foyda (manfiy — zarar) */
  equalRest: number;
  /** Optimal ulush */
  share: number;
  /** Markazning necha foizini qoplaydi */
  coverPct: number | null;
  /** O'z foydasining necha foizi Markazga ketadi */
  ofProfitPct: number | null;
  /** Qoplagandan keyin qolgan foyda — korxona foydasiga */
  rest: number;
  /** Qolgan foyda / daromad, % */
  restMargin: number | null;
  /** full — teng ulushni to'liq beradi; partial — foydasi yetmaydi, borini beradi; none — zararda */
  status: 'full' | 'partial' | 'none';
}

export interface CoverResult {
  /** Markaz sof xarajati */
  centerNet: number;
  /** Hududlar foydasi (faqat musbatlari — qoplash imkoniyati) */
  capacity: number;
  /** Hududlar jami foydasi (manfiylari bilan) */
  totalProfit: number;
  /** Qoplangan summa */
  covered: number;
  /** Qoplash foizi: imkoniyat ÷ Markaz × 100 (100 dan katta — ortiqcha bor) */
  coverPct: number | null;
  /** Ortiqcha (foydaga): Σ qolgan foyda (musbat hududlar) */
  surplus: number;
  /** Yetishmovchilik: Markazning qoplanmagan qismi */
  shortfall: number;
  /** Teng ulush M ÷ n */
  equalShare: number;
  /** Optimal ulush chegarasi λ (hech bir hudud bundan ko'p bermaydi) */
  cap: number;
  /** Teng taqsimda zararga tushadigan hududlar soni */
  equalLosers: number;
  rows: CoverRow[];
}

const pctOf = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function centerCover(regions: CoverInput[], centerNetInput: number): CoverResult {
  const centerNet = Math.max(0, centerNetInput);
  const active = regions.filter((r) => r.income !== 0 || r.profit !== 0);
  const n = active.length;
  const caps = active.map((r) => Math.max(0, r.profit));
  const capacity = caps.reduce((a, c) => a + c, 0);
  const totalProfit = active.reduce((a, r) => a + r.profit, 0);
  const target = Math.min(centerNet, capacity);

  // λ: Σ min(c_i, λ) = target (suv to'ldirish). Kichikdan kattaga — har qadamda qolganini teng bo'lamiz
  let cap = 0;
  if (target > 0) {
    const sorted = [...caps].sort((a, b) => a - b);
    let left = target;
    let i = 0;
    for (; i < sorted.length; i++) {
      const rest = sorted.length - i;
      const even = left / rest;
      if (sorted[i]! >= even) {
        cap = even;
        break;
      }
      left -= sorted[i]!;
    }
    if (i === sorted.length) cap = sorted[sorted.length - 1] ?? 0; // hammasi borini beradi
  }

  const equalShare = n > 0 ? centerNet / n : 0;
  const rows: CoverRow[] = active.map((r) => {
    const c = Math.max(0, r.profit);
    const share = target > 0 ? Math.min(c, cap) : 0;
    const rest = r.profit - share;
    return {
      ...r,
      equalShare,
      equalRest: r.profit - equalShare,
      share,
      coverPct: pctOf(share, centerNet),
      ofProfitPct: r.profit > 0 ? (share / r.profit) * 100 : null,
      rest,
      restMargin: r.income > 0 ? (rest / r.income) * 100 : null,
      // foydasi λ dan kam — borini beradi (partial); zararda — bermaydi (none)
      status: r.profit <= 0 ? 'none' : r.profit < cap - 0.5 ? 'partial' : 'full',
    };
  });
  rows.sort((a, b) => b.profit - a.profit);

  const covered = rows.reduce((a, r) => a + r.share, 0);
  return {
    centerNet,
    capacity,
    totalProfit,
    covered,
    coverPct: pctOf(capacity, centerNet),
    surplus: rows.reduce((a, r) => a + Math.max(0, r.rest), 0),
    shortfall: Math.max(0, centerNet - covered),
    equalShare,
    cap,
    equalLosers: rows.filter((r) => r.equalRest < 0).length,
    rows,
  };
}