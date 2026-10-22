// ═══════════════════════════════════════════════════════════
// Hisobotlar — yagona mazmun modeli.
// Har bir hisobot bir marta "hujjat" (ReportDoc) sifatida quriladi,
// keyin uch formatga chiqariladi: Excel, PowerPoint, PDF — raqamlar hamma joyda bir xil.
// Pul qiymatlari jadval va ko'rsatkichlarda so'mda (son), matnda tayyor ko'rinishda.
// ═══════════════════════════════════════════════════════════

export type ReportFormat = 'xlsx' | 'pptx' | 'pdf';

export const FORMAT_INFO: Record<ReportFormat, { label: string; mime: string; ext: string }> = {
  xlsx: { label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pptx: { label: 'PowerPoint', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
  pdf: { label: 'PDF', mime: 'application/pdf', ext: 'pdf' },
};

export type Tone = 'good' | 'bad' | 'neutral' | 'warn';

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}

export type ColumnFormat = 'text' | 'money' | 'mln' | 'pct' | 'signedPct' | 'int' | 'decimal' | 'decimal3';

export interface Column {
  label: string;
  format?: ColumnFormat;
  /** Nisbiy kenglik (1 — odatiy) */
  width?: number;
  /** O'zgarish rangi: 'up' — o'sish yaxshi, 'down' — kamayish yaxshi, 'row' — qator bo'yicha (TableBlock.rowTone) */
  toneBy?: 'up' | 'down' | 'row';
  /** Matnli katak rangi: qiymat → rang (masalan, "Buzilgan" → bad) */
  tones?: Record<string, Tone>;
}

export type Cell = string | number | null;

/**
 * Qatorni Munosabatga belgilash uchun modda (faqat ekranda; Excel/PPTX/PDF e'tiborsiz qoldiradi).
 * filter — reactions ItemFilter bilan bir xil kalitlar: unit, categoryCode, rootCategoryCode, source, counterparty, clientName …
 */
export interface DocMark {
  kind: 'INCOME' | 'EXPENSE' | 'RESULT';
  label: string;
  filter: Record<string, string>;
}

/** Belgi quruvchi: hisobot bitta hudud bo'yicha bo'lsa — filtrga hudud ham qo'shiladi */
export function docMark(kind: DocMark['kind'], label: string, filter: Record<string, string>, unit?: string): DocMark | null {
  // Munosabat filtri qiymatlari 80 belgidan oshmasin (reactions.metrics → cleanFilter) — uzunlari belgilanmaydi
  if (Object.values(filter).some((v) => !v || v.length > 80)) return null;
  return { kind, label: label.slice(0, 160), filter: unit && unit !== 'all' && !filter.unit ? { ...filter, unit } : filter };
}

export interface TableBlock extends Visibility {
  type: 'table';
  title?: string;
  columns: Column[];
  rows: Cell[][];
  /** Oxirgi qator — jami (qalin) */
  total?: Cell[];
  note?: string;
  /** Slayddagi eng ko'p qatorlar (qolgani Excel/PDF da) */
  slideRows?: number;
  /** toneBy: 'row' ustunlari uchun har bir qatorning yo'nalishi */
  rowTone?: ('up' | 'down' | null)[];
  /** Har qator uchun Munosabat belgisi (rows bilan bir xil tartibda; null — belgilanmaydi) */
  marks?: (DocMark | null)[];
  /**
   * Ichma-ich jadval: har qatorning darajasi (0 — eng yuqori, keyingi qatorlar — uning ichidagilari).
   * Excel'da qatorlar guruhlanadi ([+]/[−] bilan ochiladi), ekranda — bosib ochiladi.
   * Bunday jadvalda jami ustun formulalari qo'yilmaydi (ichki qatorlar yig'indiga ikki marta kirmasin).
   */
  levels?: number[];
  /** Ochilganda ko'rinadigan darajalar soni (standart 1 — faqat 0-daraja qatorlari) */
  openLevels?: number;
  /** Excel: sarlavha qatori va birinchi ustun qotiriladi (varaqdagi asosiy jadval) */
  freeze?: boolean;
  /** Excel: avtofiltr (varaqdagi yagona jadval uchun) */
  filter?: boolean;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
  /** Aralash grafik: shu qator chiziq bo'lib chiqadi */
  asLine?: boolean;
}

export interface ChartBlock extends Visibility {
  type: 'chart';
  title: string;
  kind: 'bar' | 'barh' | 'line';
  labels: string[];
  series: ChartSeries[];
  /** Qiymatlar birligi — o'q yozuvi uchun */
  unit: string;
  stacked?: boolean;
}

/**
 * Blok qaysi formatlarda chiqadi (bo'lmasa — hammasida). Ekranda (preview) — doim hammasi.
 * Masalan, batafsil jadval faqat Excel'da: formats: ['xlsx'].
 */
export interface Visibility {
  formats?: ReportFormat[];
}

export interface KpiBlock extends Visibility {
  type: 'kpis';
  /** Kartalar guruhi nomi (fakt / reja / prognoz) */
  title?: string;
  items: KpiItem[];
}

export interface NotesBlock extends Visibility {
  type: 'notes';
  title?: string;
  items: string[];
}

/** Hisoblash formulasi: ko'rsatkich nomi va qanday hisoblanishi */
export interface FormulaItem {
  name: string;
  formula: string;
}

export interface FormulasBlock extends Visibility {
  type: 'formulas';
  /** Sarlavha (masalan, "Hisob-kitob: Hududlar") — bo'lmasa bo'lim sarlavhasi */
  title?: string;
  /** Ustun nomlari; bo'lmasa — "Ko'rsatkich" va "Qanday hisoblanadi" */
  headers?: [string, string];
  items: FormulaItem[];
}

export type Block = KpiBlock | TableBlock | ChartBlock | NotesBlock | FormulasBlock;

export interface ReportSection extends Visibility {
  title: string;
  intro?: string;
  /** Excel varag'i nomi (bo'lmasa — sarlavhadan) */
  sheet?: string;
  blocks: Block[];
}

export interface ReportDoc {
  /** Hisobot turi nomi, masalan "Davr moliyaviy hisoboti" */
  kind: string;
  title: string;
  subtitle: string;
  /** Muqovadagi qisqa ma'lumot qatorlari */
  meta: string[];
  /** Eng muhim 3–6 xulosa (muqovadan keyingi sahifa) */
  highlights: string[];
  sections: ReportSection[];
  /** Fayl nomi uchun asos */
  fileBase: string;
  generatedAt: string;
  /** Excel'dagi birinchi (xulosa) varaq nomi; bo'lmasa — «Xulosa» */
  coverSheet?: string;
  /** Hisobot o'z metodikasini beradi — umumiy «Hisoblash formulalari» va ilova qo'shilmaydi */
  ownMethodology?: boolean;
}

/** Formatga ko'ra hujjat: shu formatda ko'rinmaydigan bo'lim va bloklar olib tashlanadi */
export function forFormat(doc: ReportDoc, format: ReportFormat): ReportDoc {
  const show = (v: Visibility) => !v.formats || v.formats.includes(format);
  return {
    ...doc,
    sections: doc.sections
      .filter(show)
      .map((s) => ({ ...s, blocks: s.blocks.filter(show) }))
      .filter((s) => s.blocks.length > 0),
  };
}

export interface ReportParams {
  from: string;
  to: string;
  unit?: string;
  /** Tanlangan obyekt (masalan, bitta munosabat id si) */
  subject?: string;
  /** Qo'shimcha sozlamalar (CatalogItem.options bo'yicha), masalan { compare: 'yoy', view: 'short' } */
  options?: Record<string, string>;
}

/** Hisobot sozlamasi (tanlov ro'yxati) — UI shu bo'yicha maydon chizadi */
export interface ReportOption {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}

/** Hisobot ichida bitta obyektni tanlash imkoni */
export interface SubjectOption {
  kind: 'reaction';
  /** Maydon nomi (UI) */
  label: string;
  /** Tanlanmaganda nima bo'ladi (UI) */
  emptyLabel: string;
}

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  /** Hisobot ichidagi bo'limlar (foydalanuvchiga ko'rsatiladi) */
  contents: string[];
  /** Hudud tanlash kerakmi: none — yo'q, optional — ixtiyoriy, required — majburiy */
  unit: 'none' | 'optional' | 'required';
  /** Davr kerakmi */
  period: boolean;
  formats: ReportFormat[];
  group: string;
  /** Ixtiyoriy obyekt tanlovi: tanlansa — shu obyekt bo'yicha batafsil hisobot */
  subject?: SubjectOption;
  /** Qo'shimcha sozlamalar (taqqoslash turi, ko'rinish …) */
  options?: ReportOption[];
}

export interface GenerateInput {
  type?: string;
  from?: string;
  to?: string;
  unit?: string;
  subject?: string;
  format?: string;
  options?: Record<string, unknown>;
}

export interface HistoryItem {
  id: string;
  type: string;
  title: string;
  format: ReportFormat;
  filename: string;
  size: number;
  params: ReportParams;
  createdAt: string;
  createdBy: string | null;
}