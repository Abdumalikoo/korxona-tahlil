// ═══════════════════════════════════════════════════════════
// «Umumiy hisobot» — sozlamalar BITTA joyda.
// Chegaralar korxona tasdiqlagan normativ EMAS — dastlabki (boshlang'ich) qiymatlar;
// hisobotning «Metodika» bo'limida shunday deb ko'rsatiladi. O'zgartirish — faqat shu faylda.
// ═══════════════════════════════════════════════════════════

export const GENERAL_THRESHOLDS = {
  /** Reja bajarilishi shundan past (%) — ogohlantirish */
  planExecutionWarnPct: 90,
  /** Xarajat o'sishi shundan yuqori (%) — tekshiruv */
  expenseGrowthPct: 10,
  /** Daromad pasayishi shundan yuqori (%) — tekshiruv */
  incomeDropPct: 10,
  /** Model bo'yicha zarar ehtimoli shundan katta yoki teng (%) — yuqori xavf */
  lossProbabilityHighPct: 70,
  /** Prognoz xatosi (WAPE) shundan yuqori (%) — ishonchlilik ogohlantirishi */
  forecastErrorPct: 20,
  /** Rahbariyat xulosasida ko'pi bilan nechta tavsiya */
  maxRecommendations: 5,
  /** «Nima o'zgardi» jadvalida nechta modda alohida */
  topDrivers: 8,
} as const;

export type GeneralThresholds = typeof GENERAL_THRESHOLDS;

/** Ma'lumot holati — har bir blok va ko'rsatkichda */
export type DataStatus = 'full' | 'partial' | 'nosource' | 'na' | 'error';

export const STATUS_LABEL: Record<DataStatus, string> = {
  full: "To'liq",
  partial: 'Qisman',
  nosource: "Manba yo'q",
  na: 'Hisoblanmaydi',
  error: 'Xato',
};

/** Taqqoslash turi */
export type CompareKind = 'yoy' | 'prev';

export const COMPARE_LABEL: Record<CompareKind, string> = {
  yoy: "o'tgan yilning shu davri",
  prev: "o'tgan teng davr",
};

export const NO_OWNER = "Mas'ul tayinlanishi kerak";
export const NO_DUE = 'Muddat rahbar tomonidan belgilanadi';
export const NO_HISTORY = 'Tanlangan davr uchun tarixiy holat mavjud emas';