// ═══════════════════════════════════════════════════════════
// Ijara — sozlamalar va turlar
// ═══════════════════════════════════════════════════════════

/** Ijara xarajatlari yoziladigan kategoriya (yo'q bo'lsa avtomatik yaratiladi) */
export const LEASE_CATEGORY = 'LEASE';
export const LEASE_CATEGORY_LABEL = 'Ijara';

/** Markaz hudud kodi */
export { CENTRAL_REGION } from '../../common/segments/segments';

/** QQS stavkasi, foizda — summa ichidagi QQS = summa × 12 / 112 */
export const VAT_PERCENT = 12n;

/** Hujjat hajmi chegarasi */
export const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;

/** Ruxsat etilgan hujjat turlari */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export type LeaseKindValue = 'ODDIY' | 'AEROPORT';
export type LeaseFrequencyValue = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type LeaseDocumentTypeValue = 'SHARTNOMA' | 'QOSHIMCHA_KELISHUV' | 'DALOLATNOMA' | 'BOSHQA';


/** Ijara holati tanlangan oyga nisbatan */
export type LeaseStatus = 'ACTIVE' | 'NOT_STARTED' | 'ENDED';

// ═══════════ Kiruvchi ma'lumotlar ═══════════

export interface LeaseInput {
  number?: string;
  /** "YYYY-MM-DD" */
  contractDate?: string | null;
  kind?: LeaseKindValue;
  title?: string;
  regionCode?: number;
  districtId?: string | null;
  departmentId?: string | null;
  airportName?: string | null;
  address?: string | null;
  areaM2?: number | null;
  purpose?: string | null;
  lessorName?: string;
  lessorTin?: string | null;
  lessorPhone?: string | null;
  lessorBank?: string | null;
  vatIncluded?: boolean;
  paymentFrequency?: LeaseFrequencyValue;
  paymentDay?: number | null;
  /** "YYYY-MM" */
  startPeriod?: string;
  note?: string | null;
  /** Faqat yaratishda: boshlang'ich oylik summa, tiyin (satr) */
  monthlyTiyin?: string;
}


export interface TermInput {
  /** "YYYY-MM" — shu oydan boshlab */
  validFrom?: string;
  /** Oylik summa, tiyin (satr) */
  monthlyTiyin?: string;
  note?: string | null;
}

export interface TerminateInput {
  /** Oxirgi oy "YYYY-MM" (shu oy ham hisoblanadi); null — qayta tiklash */
  endPeriod?: string | null;
  endReason?: string | null;
}

export interface LeaseListQuery {
  /** Summa va holat qaysi oy uchun (standart — joriy oy) */
  period?: string;
  kind?: string;
  regionCode?: number;
  /** active — shu oyda amalda, ended — tugagan, all — hammasi */
  status?: string;
  search?: string;
}

// ═══════════ Chiquvchi ma'lumotlar ═══════════

export interface LeasePlace {
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;

  departmentId: string | null;
  departmentName: string | null;
  airportName: string | null;
  /** "Andijon · Asaka", "Markaz · Buxgalteriya", "Toshkent aeroporti" */
  label: string;
}

export interface LeaseListItem {
  id: string;
  number: string;
  contractDate: string | null;
  kind: LeaseKindValue;
  title: string;
  place: LeasePlace;
  lessorName: string;
  areaM2: number | null;
  vatIncluded: boolean;
  paymentFrequency: LeaseFrequencyValue;
  startPeriod: string;
  endPeriod: string | null;
  status: LeaseStatus;
  /** Tanlangan oy uchun oylik summa (amalda bo'lmasa "0") */
  monthlyTiyin: string;
  /** Eng oxirgi narx (kelajakdagi o'zgarish ham) */
  latestTiyin: string;
  /** Tanlangan oydan keyin kutilayotgan narx o'zgarishi */
  nextChange: { validFrom: string; monthlyTiyin: string } | null;
  documentCount: number;
  hasContract: boolean;
}

export interface LeaseListResult {

  period: string;
  items: LeaseListItem[];
  summary: {
    total: number;
    active: number;
    ended: number;
    notStarted: number;
    /** Shu oydagi jami oylik summa */
    monthlyTiyin: string;
    withoutContract: number;
    byKind: { kind: LeaseKindValue; count: number; monthlyTiyin: string }[];
  };
}

export interface LeaseTermView {
  id: string;
  validFrom: string;
  /** Keyingi o'zgarishdan oldingi oy yoki shartnoma oxiri */
  validTo: string | null;
  monthlyTiyin: string;
  note: string | null;
  createdAt: string;
  documents: LeaseDocumentView[];
}

export interface LeaseDocumentView {
  id: string;
  termId: string | null;
  type: LeaseDocumentTypeValue;
  fileName: string;
  mimeType: string;
  sizeBytes: number;

  createdAt: string;
}

export interface LeaseAccrualView {
  period: string;
  /** Xarajatga yozilgan */
  accruedTiyin: string;
  /** Hozirgi shartlar bo'yicha hisob */
  expectedTiyin: string;
  changed: boolean;
}

export interface LeaseDetail extends Omit<LeaseListItem, 'documentCount' | 'hasContract'> {
  address: string | null;
  purpose: string | null;
  lessorTin: string | null;
  lessorPhone: string | null;
  lessorBank: string | null;
  paymentDay: number | null;
  endReason: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  terms: LeaseTermView[];
  documents: LeaseDocumentView[];
  accruals: LeaseAccrualView[];
  /** Shartnoma boshidan hozirgacha (yopilgan oylar) jami */
  accruedTotalTiyin: string;
}

/** O'zgarish yopilgan oylarga ta'sir qilsa — qayta hisoblash kerak */
export interface ChangeImpact {

  /** Summasi hozirgi shartlardan farq qiladigan yopilgan oylar */
  stalePeriods: string[];
}

export interface MonthRow {
  leaseId: string;
  number: string;
  title: string;
  kind: LeaseKindValue;
  place: LeasePlace;
  lessorName: string;
  /** Hozirgi shartlar bo'yicha */
  expectedTiyin: string;
  /** Yopilgan bo'lsa — yozilgan summa */
  accruedTiyin: string | null;
  changed: boolean;
}

export interface MonthView {
  period: string;
  close: {
    id: string;
    closedAt: string;
    closedBy: string | null;
    leaseCount: number;
    totalTiyin: string;
  } | null;
  rows: MonthRow[];
  expectedTotalTiyin: string;
  /** Yopilgandan keyin shartlar o'zgargan — qayta yopish tavsiya etiladi */
  stale: boolean;
}


export interface MonthCloseSummary {
  id: string;
  period: string;
  leaseCount: number;
  totalTiyin: string;
  closedAt: string;
  closedBy: string | null;
  stale: boolean;
}
