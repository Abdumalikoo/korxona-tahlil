import type { AssetStatus, StockDocKind, StockItemKind } from '@prisma/client';

// ═══════════════════════════════════════════════════════════
// Ombor: turlar, yorliqlar va kirish ma'lumotlari
// Kirim shu zahoti Xarajatlarga yoziladi (manba: WAREHOUSE, modda — buyum moddasi).
// Chiqim, qaytarish, ko'chirish, hisobdan chiqarish — xarajat qayta yozilmaydi,
// faqat kimda va qayerda ekani hisobga olinadi (asosiy vositalar harakati bilan).
// ═══════════════════════════════════════════════════════════

export const CENTRAL_REGION = 0;

/** Ombor xarajat moddalari: ota modda va standart bandlar (buyum boshqa moddani ham tanlashi mumkin) */
export const WAREHOUSE_PARENT_CATEGORY = 'WAREHOUSE';
export const WAREHOUSE_PARENT_LABEL = 'Ombor: TMZ va asosiy vositalar';
export const WAREHOUSE_CATEGORIES: { code: string; label: string; behavior: 'FIXED' | 'VARIABLE' | 'MIXED' }[] = [
  { code: 'WH_STATIONERY', label: 'Ombor: kanselyariya', behavior: 'VARIABLE' },
  { code: 'WH_HOUSEHOLD', label: "Ombor: xo'jalik mollari", behavior: 'VARIABLE' },
  { code: 'WH_COMPUTER', label: 'Ombor: kompyuter va orgtexnika', behavior: 'MIXED' },
  { code: 'WH_FURNITURE', label: 'Ombor: mebel va jihozlar', behavior: 'FIXED' },
  { code: 'WH_PARTS', label: 'Ombor: ehtiyot qismlar va materiallar', behavior: 'VARIABLE' },
  { code: 'WH_UNIFORM', label: 'Ombor: maxsus kiyim va himoya vositalari', behavior: 'VARIABLE' },
  { code: 'WH_OTHER', label: 'Ombor: boshqa TMZ', behavior: 'VARIABLE' },
  { code: 'WH_POSTAL', label: 'Ombor: pochta xizmatlari', behavior: 'VARIABLE' },
];

export const ITEM_KINDS: StockItemKind[] = ['TMZ', 'ASSET'];
export const ITEM_KIND_LABELS: Record<StockItemKind, string> = {
  TMZ: 'TMZ (sarflanadigan)',
  ASSET: 'Asosiy vosita',
};

export const DOC_KINDS: StockDocKind[] = ['RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'WRITE_OFF'];
export const DOC_KIND_LABELS: Record<StockDocKind, string> = {
  RECEIPT: 'Kirim',
  ISSUE: 'Chiqim (berish)',
  RETURN: 'Qaytarish',
  TRANSFER: "Ko'chirish",
  WRITE_OFF: 'Hisobdan chiqarish',
};
/** Hujjat raqami prefiksi: KR-2026-0001 */
export const DOC_PREFIX: Record<StockDocKind, string> = {
  RECEIPT: 'KR',
  ISSUE: 'CH',
  RETURN: 'QT',
  TRANSFER: 'KO',
  WRITE_OFF: 'HC',
};
/** Dalolatnoma nomi */
export const ACT_TITLES: Record<StockDocKind, string> = {
  RECEIPT: 'Tovar-moddiy boyliklarni qabul qilish dalolatnomasi',
  ISSUE: 'Tovar-moddiy boyliklarni topshirish-qabul qilish dalolatnomasi',
  RETURN: 'Tovar-moddiy boyliklarni omborga qaytarish dalolatnomasi',
  TRANSFER: "Asosiy vositalarni ko'chirish dalolatnomasi",
  WRITE_OFF: 'Tovar-moddiy boyliklarni hisobdan chiqarish dalolatnomasi',
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_STOCK: 'Omborda',
  IN_USE: 'Foydalanishda',
  WRITTEN_OFF: 'Hisobdan chiqarilgan',
};

export const UNITS = ['dona', 'kg', 'litr', 'metr', 'm²', 'pachka', 'quti', 'komplekt', 'rulon', 'juft'];

// ─────────── Kirish ma'lumotlari ───────────

export interface ItemInput {
  name?: string;
  unit?: string;
  kind?: string;
  group?: string | null;
  categoryCode?: string;
  minQty?: number | string | null;
  note?: string | null;
  isActive?: boolean;
}

/** Hujjat qatori */
export interface LineInput {
  itemId?: string;
  /** TMZ — miqdor; asosiy vosita kirimida — dona soni */
  qty?: number | string;
  /** Kirimda birlik narxi, tiyinda (satr) */
  priceTiyin?: string | number;
  /** Asosiy vosita kirimida — seriya raqamlari (ixtiyoriy, dona soniga teng yoki kam) */
  serials?: string[];
  note?: string | null;
}

/** Hujjat: turiga qarab kerakli maydonlar */
export interface DocInput {
  kind?: string;
  /** "YYYY-MM-DD" */
  date?: string;
  counterparty?: string | null;
  documentNo?: string | null;
  /** Kimga / qayerga: bo'lim yoki hudud ("center" yoki "r:N"), odam */
  departmentId?: string | null;
  regionCode?: number | string | null;
  holderPinfl?: string | null;
  holderName?: string | null;
  issuedBy?: string | null;
  responsible?: string | null;
  reason?: string | null;
  note?: string | null;
  /** Kirim xarajati: to'lov usuli */
  paymentMethod?: string;
  /** TMZ qatorlari */
  lines?: LineInput[];
  /** Asosiy vositalar (chiqim, qaytarish, ko'chirish, hisobdan chiqarish) — asset id lar */
  assetIds?: string[];
  /** Har bir vositaning holati (dalolatnomaning «Ҳолати» ustuni): assetId → «Янги», «Ишлатилган» … */
  conditions?: Record<string, string> | null;
}

export interface DocFilter {
  kind?: string;
  from?: string;
  to?: string;
  search?: string;
  departmentId?: string;
  regionCode?: string;
}

export interface AssetFilter {
  status?: string;
  departmentId?: string;
  regionCode?: string;
  holder?: string;
  itemId?: string;
  search?: string;
}

// ─────────── Javoblar ───────────

export interface Place {
  departmentId: string | null;
  departmentName: string | null;
  regionCode: number | null;
  regionName: string | null;
  holderPinfl: string | null;
  holderName: string | null;
  /** Bir qatorda: "Strategiya bo'limi · Aliyev A." */
  text: string;
}

export interface ItemView {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: StockItemKind;
  group: string | null;
  categoryCode: string;
  categoryLabel: string;
  minQty: number | null;
  note: string | null;
  isActive: boolean;
  /** Omborda: TMZ — miqdor, asosiy vosita — dona */
  inStock: number;
  /** Asosiy vosita: foydalanishda */
  inUse: number;
  /** O'rtacha tannarx (tiyin) */
  avgPriceTiyin: string;
  /** Oxirgi kirim narxi (tiyin) — yangi kirimda o'zi qo'yiladi */
  lastPriceTiyin: string | null;
  /** Ombordagi qiymat (tiyin) */
  stockValueTiyin: string;
  low: boolean;
}

export interface LineView {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  kind: StockItemKind;
  qty: number;
  priceTiyin: string;
  amountTiyin: string;
  expenseId: string | null;
  note: string | null;
}

export interface DocView {
  id: string;
  number: string;
  kind: StockDocKind;
  kindLabel: string;
  date: string;
  period: string;
  counterparty: string | null;
  documentNo: string | null;
  to: Place;
  from: Place | null;
  issuedBy: string | null;
  responsible: string | null;
  reason: string | null;
  note: string | null;
  totalTiyin: string;
  lines: LineView[];
  assets: { id: string; inventoryNo: string; name: string; priceTiyin: string; condition: string | null }[];
  createdAt: string;
  /** Kim kiritdi: «F.I.Sh. (SK-0001)» */
  createdByName: string | null;
  cancelled: boolean;
  cancelledAt: string | null;
  cancelledByName: string | null;
}

export interface AssetView {
  id: string;
  inventoryNo: string;
  itemId: string;
  itemName: string;
  group: string | null;
  name: string;
  serialNo: string | null;
  priceTiyin: string;
  acquiredAt: string;
  status: AssetStatus;
  statusLabel: string;
  place: Place;
  note: string | null;
}

export interface AssetMoveView {
  id: string;
  kind: StockDocKind;
  kindLabel: string;
  date: string;
  docId: string | null;
  docNumber: string | null;
  from: Place;
  to: Place;
  note: string | null;
}

export interface WarehouseOverview {
  items: number;
  tmzValueTiyin: string;
  assetsTotal: number;
  assetsInStock: number;
  assetsInUse: number;
  assetsValueTiyin: string;
  lowItems: { id: string; name: string; unit: string; inStock: number; minQty: number }[];
  /** Davr: kirim (= xarajat) va chiqim summalari */
  period: { from: string; to: string; receiptsTiyin: string; issuesTiyin: string; receipts: number; issues: number };
  /** Kimda nima bor: bo'lim/hudud bo'yicha asosiy vositalar va berilgan TMZ */
  byPlace: { key: string; name: string; assets: number; assetsValueTiyin: string; tmzIssuedTiyin: string }[];
}

/** Kimda nima bor: odam, bo'lim yoki hudud */
export interface HoldingsView {
  /** Kim: «Aliyev Anvar · Mutaxassis · Strategiya bo'limi» yoki bo'lim / hudud nomi */
  title: string;
  /** Foydalanishdagi asosiy vositalar */
  assets: AssetView[];
  /** Berilgan va hali qaytmagan TMZ (chiqim − qaytarish) */
  tmz: { itemId: string; itemCode: string; itemName: string; unit: string; qty: number; avgPriceTiyin: string }[];
  /** Oxirgi chiqim hujjati — «takrorlash» uchun */
  lastIssue: DocView | null;
}

// ─────────── Inventarizatsiya ───────────

export interface CountInput {
  date?: string;
  chairman?: string | null;
  commission?: string | null;
  note?: string | null;
}

export interface CountSaveInput extends CountInput {
  lines?: { itemId: string; actualQty: number | null }[];
  assets?: { assetId: string; found: boolean | null }[];
}

export interface CountLineView {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  group: string | null;
  /** Hisobda (sanoq davomida — jonli, yakunlangach — saqlangan) */
  bookQty: number;
  /** Haqiqatda (null — sanalmagan) */
  actualQty: number | null;
  /** Haqiqatda − hisobda (manfiy — kamomad, musbat — ortiqcha) */
  diffQty: number | null;
  priceTiyin: string;
  diffAmountTiyin: string | null;
}

export interface CountAssetView {
  assetId: string;
  inventoryNo: string;
  name: string;
  serialNo: string | null;
  priceTiyin: string;
  /** Sanoq boshlangandan keyin omborddan berilgan — tekshirilmaydi */
  moved: boolean;
  found: boolean | null;
}

export interface CountView {
  id: string;
  number: string;
  date: string;
  status: 'DRAFT' | 'DONE';
  chairman: string | null;
  commission: string | null;
  note: string | null;
  lines: CountLineView[];
  assets: CountAssetView[];
  totals: { lines: number; counted: number; shortageTiyin: string; surplusTiyin: string; shortageLines: number; surplusLines: number };
  writeOffDocId: string | null;
  receiptDocId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CountListItem {
  id: string;
  number: string;
  date: string;
  status: 'DRAFT' | 'DONE';
  lines: number;
  counted: number;
  shortages: number | null;
  surpluses: number | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Dalolatnoma mazmuni — Word va ekrandagi ko'rinish bir xil (warehouse.acts.ts › model) */
export interface ActModel {
  number: string;
  kind: StockDocKind;
  /** O'ng yuqori blok: «ТАСДИҚЛАЙМАН», tashkilot, lavozim, imzo + ism, sana */
  approve: string[];
  approveBold: boolean;
  title: string;
  title2: string;
  cancelled: boolean;
  dateText: string;
  city: string;
  /** Kirish va tomonlar — har biri alohida xatboshi */
  intro: string[];
  lead: string;
  columns: string[];
  rows: string[][];
  total: string[];
  closing: string[];
  liability: string;
  note: string | null;
  /** «Lavozim:» — qalin, o'ngda imzo chizig'i va ism (name null — oddiy qator) */
  signatures: { label: string; name: string | null }[];
  agreedHeading: string;
  agreed: { title: string; name: string }[];
  footer: string | null;
}