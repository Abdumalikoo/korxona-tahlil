import type { CompareMode, DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma: hududlar va Markaz — daromad va xarajat
// ═══════════════════════════════════════════════════════════

/** region — hudud, center — Markaz, unassigned — hech qaysi hududga biriktirilmagan */
export type UnitKind = 'region' | 'center' | 'unassigned';

export interface UnitPart {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export interface RegionUnit {
  /** "r:3", "center", "none" */
  key: string;
  /** Hudud kodi (Markaz — 0, biriktirilmagan — null) */
  code: number | null;
  name: string;
  kind: UnitKind;

  incomeTiyin: string;
  previousIncomeTiyin: string;
  expenseTiyin: string;
  previousExpenseTiyin: string;
  /** Xarajat ichidan: shu hudud xodimlari ish haqi */
  payrollTiyin: string;
  previousPayrollTiyin: string;

  /** Xarajat tarkibi: ish haqi, ijara, mashinalar, boshqa guruhlar */
  expenseParts: UnitPart[];
  /** Daromad keltirgan xizmat turlari (eng kattalari) */
  incomeParts: UnitPart[];

  /** Xodimlar bo'limidan: davr ichida ishlagan xodimlar soni */
  headcount: number;
  previousHeadcount: number;

  /** 24 oylik trend (months tartibida) */
  incomeTrend: string[];
  expenseTrend: string[];

  incomeCount: number;
  expenseCount: number;

  /**
   * Faqat Markaz uchun (Xarajatlar siyosati): Markaz xarajati ikki guruhda —
   * o'ziniki (doimiy) va hududlar uchun (bayram puli, komandirovka, internet …, qaysi hududda yozilgan bo'lsa ham)
   */
  centerSplit?: {
    ownTiyin: string;
    regionalTiyin: string;
    previousOwnTiyin: string;
    previousRegionalTiyin: string;
    /** 2-guruh: asosiy vositalar sarfi (eskirish) — xarid balansda, xarajatga faqat sarf */
    assetsTiyin?: string;
    previousAssetsTiyin?: string;
    /** Hududlar uchun xarajat qaysi hududga tegishli (code null — Markazda yozilgan) */
    byRegion: { code: number | null; amountTiyin: string }[];
  };
}

export interface RegionsResult {
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  months: string[];
  units: RegionUnit[];
  notes: string[];
}