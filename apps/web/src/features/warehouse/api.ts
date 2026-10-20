import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Ombor API — backend warehouse.types.ts bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type ItemKind = 'TMZ' | 'ASSET';
export type DocKind = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'TRANSFER' | 'WRITE_OFF';
export type AssetStatus = 'IN_STOCK' | 'IN_USE' | 'WRITTEN_OFF';

export const ITEM_KIND_LABELS: Record<ItemKind, string> = { TMZ: 'TMZ', ASSET: 'Asosiy vosita' };
export const DOC_KIND_LABELS: Record<DocKind, string> = {
  RECEIPT: 'Kirim',
  ISSUE: 'Chiqim (berish)',
  RETURN: 'Qaytarish',
  TRANSFER: "Ko'chirish",
  WRITE_OFF: 'Hisobdan chiqarish',
};
/** Har hujjat turi nima qiladi — formada va ro'yxatda izoh */
export const DOC_KIND_HINTS: Record<DocKind, string> = {
  RECEIPT: "Omborga keldi. Summa shu zahoti Xarajatlarga yoziladi (manba: Ombor).",
  ISSUE: "Odamga yoki bo'limga berildi. Asosiy vositalar unga biriktiriladi.",
  RETURN: 'Omborga qaytib keldi.',
  TRANSFER: "Asosiy vosita bir bo'lim/odamdan boshqasiga o'tdi.",
  WRITE_OFF: "Yaroqsiz, yo'qolgan yoki sarflangan — hisobdan chiqariladi.",
};
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_STOCK: 'Omborda',
  IN_USE: 'Foydalanishda',
  WRITTEN_OFF: 'Hisobdan chiqarilgan',
};

export interface Place {
  departmentId: string | null;
  departmentName: string | null;
  regionCode: number | null;
  regionName: string | null;
  holderPinfl: string | null;
  holderName: string | null;
  text: string;
}

export interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: ItemKind;
  group: string | null;
  categoryCode: string;
  categoryLabel: string;
  minQty: number | null;
  note: string | null;
  isActive: boolean;
  inStock: number;
  inUse: number;
  avgPriceTiyin: string;
  /** Oxirgi kirim narxi — yangi kirimda o'zi qo'yiladi */
  lastPriceTiyin: string | null;
  stockValueTiyin: string;
  low: boolean;
}

export interface DocLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  kind: ItemKind;
  qty: number;
  priceTiyin: string;
  amountTiyin: string;
  expenseId: string | null;
  note: string | null;
}

export interface WarehouseDoc {
  id: string;
  number: string;
  kind: DocKind;
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
  lines: DocLine[];
  assets: { id: string; inventoryNo: string; name: string; priceTiyin: string; condition?: string | null }[];
  createdAt: string;
  /** Kim kiritdi: «F.I.Sh. (SK-0001)» */
  createdByName: string | null;
  cancelled: boolean;
  cancelledAt: string | null;
  cancelledByName: string | null;
}

export interface WarehouseAsset {
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

export interface AssetMove {
  id: string;
  kind: DocKind;
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
  period: { from: string; to: string; receiptsTiyin: string; issuesTiyin: string; receipts: number; issues: number };
  byPlace: { key: string; name: string; assets: number; assetsValueTiyin: string; tmzIssuedTiyin: string }[];
}

export interface WarehouseLookups {
  departments: { id: string; name: string }[];
  regions: { code: number; name: string }[];
  categories: { code: string; label: string; parentCode: string | null }[];
  units: string[];
  groups: string[];
}

export interface EmployeeOption {
  pinfl: string;
  fullName: string;
  position: string | null;
  regionCode: number;
  departmentId: string | null;
  place: string;
}

/** Kimda nima bor: odam, bo'lim yoki hudud */
export interface Holdings {
  /** Kim: «Aliyev Anvar · Mutaxassis · Strategiya bo'limi» yoki bo'lim / hudud */
  title: string;
  assets: WarehouseAsset[];
  tmz: { itemId: string; itemCode: string; itemName: string; unit: string; qty: number; avgPriceTiyin: string }[];
  lastIssue: WarehouseDoc | null;
  /** Imzo kutayotgan dalolatnomalar (xodim telefonda tasdiqlamagan) va ulardagi vositalar */
  pendingSigns?: { docId: string; number: string; date: string; assetIds: string[] }[];
}

/** Dalolatnomaning elektron tasdig'i: QR → telefonda imzo */
export interface SignStatus {
  docId: string | null;
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  url: string;
  qr: string;
  signerPinfl: string;
  signerName: string;
  createdAt: string;
  signedAt: string | null;
  signature: string | null;
  /** Yuz surati bilan tasdiqlangan bo'lsa (JPEG data URL) */
  photo: string | null;
  /** DRAWN — imzo chizilgan, PHOTO — yuz surati */
  method: string | null;
  signedIp: string | null;
  hasArchive: boolean;
  archiveName: string | null;
  telegram: { employee?: string; archive?: string; at?: string } | null;
  localOnly: boolean;
}

/** Saqlashdan oldingi tasdiq: «Tasdiqlash» → QR → xodim imzolaydi → «Saqlash» */
export interface SignDraft extends SignStatus {
  id: string;
  saved: boolean;
  expired: boolean;
  act: ActModel;
}

/** Shablonning oxirgi tasdig'i */
export interface TemplateApproval {
  id: string;
  signerName: string;
  signedAt: string | null;
  method: string | null;
  savedAt: string;
}

/** Imzolovchi xodim yo'q — oddiy saqlash (dalolatnoma qog'ozda imzolanadi) */
export interface NoSignNeeded {
  needsSign: false;
  reason: string;
}

export interface SignListItem {
  /** Tasdiq raqami (imzoli nusxani yuklash) */
  id: string;
  /** Hujjat; shablon tasdig'ida — null */
  docId: string | null;
  number: string;
  /** Hujjat turi yoki 'TEMPLATE' (dalolatnoma shabloni) */
  kind: DocKind | 'TEMPLATE';
  kindLabel: string;
  date: string;
  signerName: string;
  status: 'PENDING' | 'SIGNED';
  createdAt: string;
  signedAt: string | null;
  method?: string | null;
  telegram: SignStatus['telegram'];
}

/** Elektron tasdiq faqat shu hujjatlarda (xodim imzolaydi) */
export const SIGNABLE_KINDS: DocKind[] = ['ISSUE', 'TRANSFER', 'RETURN'];

/** Kimda nima bor so'rovi: odam (PINFL yoki ism), bo'lim yoki hudud */
export interface HolderQuery {
  holderPinfl?: string | null;
  holderName?: string | null;
  departmentId?: string | null;
  regionCode?: string | null;
}

// ─────────── Inventarizatsiya ───────────

export interface CountLine {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  group: string | null;
  bookQty: number;
  actualQty: number | null;
  diffQty: number | null;
  priceTiyin: string;
  diffAmountTiyin: string | null;
}

export interface CountAsset {
  assetId: string;
  inventoryNo: string;
  name: string;
  serialNo: string | null;
  priceTiyin: string;
  moved: boolean;
  found: boolean | null;
}

export interface StockCount {
  id: string;
  number: string;
  date: string;
  status: 'DRAFT' | 'DONE';
  chairman: string | null;
  commission: string | null;
  note: string | null;
  lines: CountLine[];
  assets: CountAsset[];
  totals: { lines: number; counted: number; shortageTiyin: string; surplusTiyin: string; shortageLines: number; surplusLines: number };
  writeOffDocId: string | null;
  receiptDocId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface StockCountRow {
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

// ─────────── Pochta to'lovlari ───────────

export interface PostalPayment {
  id: string;
  date: string;
  company: string;
  amountTiyin: string;
  paymentMethod: string;
  documentNo: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PostalList {
  from: string;
  to: string;
  items: PostalPayment[];
  totalTiyin: string;
  byCompany: { company: string; totalTiyin: string; count: number }[];
  companies: string[];
}

export interface Supplier {
  name: string;
  lastDate: string;
  count: number;
}

/** Har hujjat turining alohida kiritish sahifasi */
export const DOC_KIND_PATHS: Record<DocKind, string> = {
  RECEIPT: '/ombor/kirim',
  ISSUE: '/ombor/chiqim',
  TRANSFER: '/ombor/kochirish',
  RETURN: '/ombor/qaytarish',
  WRITE_OFF: '/ombor/hisobdan-chiqarish',
};

export interface ItemPayload {
  name: string;
  unit: string;
  kind: ItemKind;
  group: string | null;
  categoryCode: string;
  minQty: number | null;
  note: string | null;
}

export interface DocPayload {
  kind: DocKind;
  date: string;
  counterparty?: string | null;
  documentNo?: string | null;
  departmentId?: string | null;
  regionCode?: number | null;
  holderPinfl?: string | null;
  holderName?: string | null;
  issuedBy?: string | null;
  responsible?: string | null;
  reason?: string | null;
  note?: string | null;
  paymentMethod?: string;
  lines?: { itemId: string; qty: number; priceTiyin?: string; serials?: string[]; note?: string | null }[];
  assetIds?: string[];
  /** Dalolatnomaning «Ҳолати» ustuni: assetId → holati */
  conditions?: Record<string, string>;
}

/** Ombor demosi holati */
export interface WarehouseDemoStatus {
  items: number;
  docs: number;
  assets: number;
  postal: number;
  /** Demo kirimlari va pochta — Xarajatlarga tushgan summa */
  expenseTiyin: string;
}

/** Dalolatnoma shabloni (Ombor › Shablon) */
export interface SignerT {
  title: string;
  name: string;
  /** Xodimlar bo'limidan tanlangan — dalolatnomada ism shu xodimdan olinadi */
  pinfl?: string | null;
}
export interface ActKindTexts {
  title: string;
  title2: string;
  intro: string;
  parties: string[];
  lead: string;
  closing: string[];
  liability: string;
  signatures: string[];
}
export interface ActRegionOverride {
  approverPosition?: string;
  approverName?: string;
  approverPinfl?: string;
  storekeeperPinfl?: string;
  company?: string;
  city?: string;
  storekeeperTitle?: string;
  storekeeperName?: string;
  agreed?: SignerT[];
}
export interface ActTemplate {
  approveHeading: string;
  company: string;
  approverPosition: string;
  approverName: string;
  approverPinfl: string | null;
  approveDate: 'doc' | 'blank';
  actDate: 'doc' | 'blank';
  city: string;
  storekeeperTitle: string;
  storekeeperName: string;
  storekeeperPinfl: string | null;
  agreedHeading: string;
  agreed: SignerT[];
  columns: string[];
  totalLabel: string;
  unitDefault: string;
  conditionDefault: string;
  shortNames: boolean;
  namesScript: 'asis' | 'cyrl';
  footer: boolean;
  kinds: Record<DocKind, ActKindTexts>;
  regions: Record<string, ActRegionOverride>;
}

/** Dalolatnoma mazmuni (serverda shablon bo'yicha to'ldirilgan) */
export interface ActModel {
  number: string;
  kind: DocKind;
  approve: string[];
  approveBold: boolean;
  title: string;
  title2: string;
  cancelled: boolean;
  dateText: string;
  city: string;
  intro: string[];
  lead: string;
  columns: string[];
  rows: string[][];
  total: string[];
  closing: string[];
  liability: string;
  note: string | null;
  signatures: { label: string; name: string | null }[];
  agreedHeading: string;
  agreed: { title: string; name: string }[];
  footer: string | null;
  sign: {
    status: 'PENDING' | 'SIGNED';
    url: string;
    qr: string;
    signedAt: string | null;
    signature: string | null;
    photo?: string | null;
    method?: string | null;
    signerLine: number;
    /** Shablon tasdig'ida — imzo «ТАСДИҚЛАЙМАН» blokidagi qatorga */
    approveLine?: number;
    stamp: string;
  } | null;
}

/** Holat uchun tayyor variantlar (dalolatnoma «Ҳолати» ustuni) */
export const CONDITION_OPTIONS = ['Янги', 'Ишлатилган, соз', 'Яхши', 'Қониқарли', 'Нуқсони бор', 'Носоз'];

export const warehouseApi = {
  actTemplate: () => api.get<ApiResponse<ActTemplate>>('/warehouse/act-template'),
  saveActTemplate: (t: ActTemplate) => api.patch<ApiResponse<ActTemplate>>('/warehouse/act-template', t),
  resetActTemplate: () => api.post<ApiResponse<ActTemplate>>('/warehouse/act-template/reset'),

  lookups: () => api.get<ApiResponse<WarehouseLookups>>('/warehouse/lookups'),
  suppliers: () => api.get<ApiResponse<Supplier[]>>('/warehouse/suppliers'),
  holdings: (params: HolderQuery) => api.get<ApiResponse<Holdings>>('/warehouse/holdings', { params: { ...params } }),

  postal: (from: string, to: string) => api.get<ApiResponse<PostalList>>('/warehouse/postal', { params: { from, to } }),
  createPostal: (payload: { date: string; company: string; amountTiyin: string; paymentMethod: string; documentNo?: string | null; note?: string | null }) =>
    api.post<ApiResponse<PostalPayment>>('/warehouse/postal', payload),
  cancelPostal: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/warehouse/postal/${id}`),

  /** Demo (faqat administrator): 35 ta buyum, 3 oylik hujjatlar, pochta to'lovlari */
  demoStatus: () => api.get<ApiResponse<WarehouseDemoStatus>>('/warehouse/demo'),
  createDemo: () => api.post<ApiResponse<WarehouseDemoStatus>>('/warehouse/demo'),
  removeDemo: () => api.delete<ApiResponse<WarehouseDemoStatus>>('/warehouse/demo'),

  counts: () => api.get<ApiResponse<StockCountRow[]>>('/warehouse/counts'),
  count: (id: string) => api.get<ApiResponse<StockCount>>(`/warehouse/counts/${id}`),
  createCount: (payload: { date: string; chairman?: string | null; commission?: string | null; note?: string | null }) =>
    api.post<ApiResponse<StockCount>>('/warehouse/counts', payload),
  saveCount: (
    id: string,
    payload: {
      date?: string;
      chairman?: string | null;
      commission?: string | null;
      note?: string | null;
      lines?: { itemId: string; actualQty: number | null }[];
      assets?: { assetId: string; found: boolean | null }[];
    },
  ) => api.patch<ApiResponse<StockCount>>(`/warehouse/counts/${id}`, payload),
  finishCount: (id: string) => api.post<ApiResponse<StockCount>>(`/warehouse/counts/${id}/finish`),
  removeCount: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/warehouse/counts/${id}`),
  employees: (search: string) => api.get<ApiResponse<EmployeeOption[]>>('/warehouse/employees', { params: { search } }),
  overview: (from: string, to: string) => api.get<ApiResponse<WarehouseOverview>>('/warehouse/overview', { params: { from, to } }),

  items: (params: { kind?: ItemKind; search?: string; all?: boolean } = {}) =>
    api.get<ApiResponse<WarehouseItem[]>>('/warehouse/items', { params: { kind: params.kind, search: params.search || undefined, all: params.all ? '1' : undefined } }),
  createItem: (payload: ItemPayload) => api.post<ApiResponse<WarehouseItem>>('/warehouse/items', payload),
  updateItem: (id: string, payload: Partial<ItemPayload> & { isActive?: boolean }) => api.patch<ApiResponse<WarehouseItem>>(`/warehouse/items/${id}`, payload),
  removeItem: (id: string) => api.delete<ApiResponse<{ id: string; archived: boolean }>>(`/warehouse/items/${id}`),

  docs: (params: { kind?: DocKind; from?: string; to?: string; search?: string } = {}) =>
    api.get<ApiResponse<WarehouseDoc[]>>('/warehouse/docs', { params: { kind: params.kind, from: params.from, to: params.to, search: params.search || undefined } }),
  doc: (id: string) => api.get<ApiResponse<WarehouseDoc>>(`/warehouse/docs/${id}`),
  /** Dalolatnoma — ekranda ko'rish uchun (Word bilan bir xil mazmun) */
  actView: (id: string) => api.get<ApiResponse<ActModel>>(`/warehouse/docs/${id}/act-view`),
  signStatus: (id: string) => api.get<ApiResponse<SignStatus | null>>(`/warehouse/docs/${id}/sign`),
  /** «Rasmiylashtirish»: QR havola (origin — telefon ochadigan manzil uchun) */
  startSign: (id: string) => api.post<ApiResponse<SignStatus>>(`/warehouse/docs/${id}/sign`, { origin: typeof window !== 'undefined' ? window.location.origin : null }),
  cancelSign: (id: string) => api.post<ApiResponse<SignStatus | null>>(`/warehouse/docs/${id}/sign/cancel`),
  resendSign: (id: string) => api.post<ApiResponse<SignStatus>>(`/warehouse/docs/${id}/sign/resend`),
  signs: (status?: 'PENDING' | 'SIGNED') => api.get<ApiResponse<SignListItem[]>>('/warehouse/signs', { params: { status } }),
  createDoc: (payload: DocPayload) => api.post<ApiResponse<WarehouseDoc>>('/warehouse/docs', payload),
  /** «Tasdiqlash»: hujjat tekshiriladi, dalolatnoma va QR tayyorlanadi — bazaga hali yozilmaydi */
  createSignDraft: (input: DocPayload) =>
    api.post<ApiResponse<SignDraft | NoSignNeeded>>('/warehouse/sign-drafts', { input, origin: typeof window !== 'undefined' ? window.location.origin : null }),
  signDraft: (id: string) => api.get<ApiResponse<SignDraft>>(`/warehouse/sign-drafts/${id}`),
  cancelSignDraft: (id: string) => api.post<ApiResponse<SignDraft>>(`/warehouse/sign-drafts/${id}/cancel`),
  /** Imzolangandan keyin «Saqlash»: hujjat bazaga, imzoli nusxa arxivga va Telegram'ga */
  /** Shablonni rahbar tasdiqlashi: QR (shablon hali saqlanmaydi); signerPinfl — boshqa tasdiqlovchi */
  createTemplateApproval: (template: ActTemplate, signerPinfl?: string | null) =>
    api.post<ApiResponse<SignDraft>>('/warehouse/act-template/approval', { template, signerPinfl: signerPinfl ?? null, origin: typeof window !== 'undefined' ? window.location.origin : null }),
  templateApproval: () => api.get<ApiResponse<TemplateApproval | null>>('/warehouse/act-template/approval'),
  commitSignDraft: (id: string) => api.post<ApiResponse<{ doc: WarehouseDoc; template?: ActTemplate; sign: SignStatus }>>(`/warehouse/sign-drafts/${id}/commit`),
  cancelDoc: (id: string) => api.post<ApiResponse<WarehouseDoc>>(`/warehouse/docs/${id}/cancel`),

  assets: (params: { status?: AssetStatus; search?: string; departmentId?: string; regionCode?: string; holder?: string; itemId?: string } = {}) =>
    api.get<ApiResponse<WarehouseAsset[]>>('/warehouse/assets', { params: { ...params, search: params.search || undefined } }),
  asset: (id: string) => api.get<ApiResponse<{ asset: WarehouseAsset; moves: AssetMove[] }>>(`/warehouse/assets/${id}`),
  updateAsset: (id: string, payload: { serialNo?: string | null; note?: string | null; name?: string }) =>
    api.patch<ApiResponse<WarehouseAsset>>(`/warehouse/assets/${id}`, payload),
};

/** Word faylni yuklab olish (nomi — serverdan, bo'lmasa fallback) */
async function downloadWord(path: string, fallbackName: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();
  const response = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    let message = "Faylni yuklab bo'lmadi";
    try {
      const body = (await response.json()) as { error?: { message?: string | string[] } };
      const m = body.error?.message;
      if (m) message = Array.isArray(m) ? (m[0] ?? message) : m;
    } catch {
      // javob JSON emas
    }
    throw new Error(message);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = star ? decodeURIComponent(star[1]!) : fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shablon namunasi (Word): saqlanmagan o'zgarishlar bilan ham */
export async function downloadActSample(kind: DocKind, regionCode: number | null, template?: ActTemplate): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();
  const response = await fetch(`${base}/warehouse/act-template/sample`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ kind, regionCode, template }),
  });
  if (!response.ok) throw new Error("Namunani yuklab bo'lmadi");
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = star ? decodeURIComponent(star[1]!) : 'namuna.docx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Hujjat dalolatnomasi (Word) */
export function downloadAct(doc: { id: string; number: string }): Promise<void> {
  return downloadWord(`/warehouse/docs/${doc.id}/act`, `${doc.number} - dalolatnoma.docx`);
}

/** Inventarizatsiya dalolatnomasi (Word) */
export function downloadCountAct(count: { id: string; number: string }): Promise<void> {
  return downloadWord(`/warehouse/counts/${count.id}/act`, `${count.number} - inventarizatsiya dalolatnomasi.docx`);
}

/** Kimda nima bor — mulk kartochkasi (Word) */
export function downloadCard(q: HolderQuery): Promise<void> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  return downloadWord(`/warehouse/holdings/card?${params.toString()}`, 'mulk kartochkasi.docx');
}

/** Tanlangan oluvchi → so'rov va manzil parametrlari (kiritish sahifalarida oldindan to'ldirish uchun) */
export function holderQuery(t: { holderPinfl: string; holderName: string; departmentId: string; regionCode: string }): HolderQuery {
  if (t.holderPinfl) return { holderPinfl: t.holderPinfl };
  if (t.holderName) return { holderName: t.holderName };
  if (t.departmentId) return { departmentId: t.departmentId };
  return { regionCode: t.regionCode };
}

/** Kiritish sahifasiga oluvchini uzatish: ?pinfl=&name=&dept=&region= */
export function targetSearch(t: { holderPinfl: string; holderName: string; departmentId: string; regionCode: string }): string {
  const p = new URLSearchParams();
  if (t.holderPinfl) p.set('pinfl', t.holderPinfl);
  if (t.holderName) p.set('name', t.holderName);
  if (t.departmentId) p.set('dept', t.departmentId);
  if (t.regionCode !== '') p.set('region', t.regionCode);
  return p.toString();
}

/** Miqdor: 12 yoki 2,5 */
export function qtyText(q: number): string {
  return Number.isInteger(q) ? q.toLocaleString('ru-RU').replace(/,/g, ' ') : q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

/** Imzolangan nusxa (Word) */
export function downloadSignedAct(doc: { id: string; number: string }): Promise<void> {
  return downloadWord(`/warehouse/docs/${doc.id}/sign/archive`, `${doc.number} - dalolatnoma (imzolangan).docx`);
}

/** Imzoli nusxa — tasdiq raqami bo'yicha (shablon tasdig'i ham) */
export function downloadSignArchive(id: string, name: string): Promise<void> {
  return downloadWord(`/warehouse/sign-drafts/${id}/archive`, name);
}