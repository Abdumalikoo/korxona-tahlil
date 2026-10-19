import { api, type ApiResponse } from '@/lib/api';
import type { WarehouseItem } from '@/features/warehouse/api';

// ═══════════════════════════════════════════════════════════
// Xarid: yetkazuvchilar, arizalar, birja va oddiy xaridlar, to'lovlar, omborga qabul.
// ═══════════════════════════════════════════════════════════

export type PurchaseKind = 'EXCHANGE' | 'DIRECT';
export type PurchaseStatus = 'OPEN' | 'DELIVERED' | 'CANCELLED';
export type RequestStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'REJECTED';
export type ReceiptStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type PurchaseFilter = 'active' | 'delivered' | 'unpaid' | 'late' | 'cancelled' | 'all';

export const KIND_LABELS: Record<PurchaseKind, string> = { EXCHANGE: 'Birja', DIRECT: 'Oddiy xarid' };
export const STATUS_LABELS: Record<PurchaseStatus, string> = { OPEN: 'Kutilmoqda', DELIVERED: 'Yetkazildi', CANCELLED: 'Bekor' };
export const REQUEST_LABELS: Record<RequestStatus, string> = { NEW: 'Yangi', IN_PROGRESS: 'Ishda', DONE: 'Bajarildi', REJECTED: 'Rad etildi' };
export const RECEIPT_LABELS: Record<ReceiptStatus, string> = { PENDING: 'Omborchi kutilmoqda', ACCEPTED: 'Qabul qilindi', REJECTED: 'Qaytarildi' };
export const METHOD_LABELS: Record<string, string> = { BANK: "Bank o'tkazmasi", CASH: 'Naqd', CARD: 'Karta', OTHER: 'Boshqa' };

export interface PurchaseLine {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  qty: number;
  priceTiyin: string;
  amountTiyin: string;
  receivedQty: number;
}

export interface Purchase {
  id: string;
  number: string;
  kind: PurchaseKind;
  date: string;
  supplierId: string | null;
  supplierName: string;
  lotNo: string | null;
  exchange: string | null;
  documentNo: string | null;
  deliveryDue: string | null;
  paymentDue: string | null;
  requestId: string | null;
  requestNumber: string | null;
  status: PurchaseStatus;
  totalTiyin: string;
  feeTiyin: string;
  paidTiyin: string;
  debtTiyin: string;
  pendingReceipts: number;
  deliveryLate: boolean;
  paymentLate: boolean;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  deliveredAt: string | null;
  lines: PurchaseLine[];
  payments: { id: string; date: string; amountTiyin: string; method: string; note: string | null }[];
  receipts: { id: string; number: string; status: ReceiptStatus; date: string }[];
}

export interface PurchaseInput {
  kind: PurchaseKind;
  date: string;
  supplierId: string | null;
  supplierName: string | null;
  lotNo: string | null;
  exchange: string | null;
  documentNo: string | null;
  deliveryDue: string | null;
  paymentDue: string | null;
  requestId: string | null;
  feeTiyin: number;
  note: string | null;
  lines: { itemId: string; qty: number; priceTiyin: number }[];
}

export interface Supplier {
  id: string;
  name: string;
  inn: string | null;
  phone: string | null;
  note: string | null;
  isActive: boolean;
  purchases: number;
  totalTiyin: string;
  paidTiyin: string;
  debtTiyin: string;
  lastDate: string | null;
}

export interface PurchaseRequest {
  id: string;
  number: string;
  date: string;
  departmentId: string | null;
  departmentName: string | null;
  requester: string | null;
  title: string;
  note: string | null;
  status: RequestStatus;
  rejectReason: string | null;
  lines: { id: string; name: string; qty: number; unit: string; itemId: string | null }[];
  purchases: { id: string; number: string }[];
}

export interface Receipt {
  id: string;
  number: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierName: string;
  documentNo: string | null;
  date: string;
  status: ReceiptStatus;
  note: string | null;
  rejectReason: string | null;
  totalTiyin: string;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  stockDocId: string | null;
  lines: { itemId: string; itemName: string; unit: string; qty: number; priceTiyin: string; amountTiyin: string }[];
}

export interface PurchaseLookups {
  departments: { id: string; name: string }[];
  categories: { code: string; label: string; parentCode: string | null }[];
  units: string[];
  groups: string[];
  suppliers: { id: string; name: string }[];
  methods: { value: string; label: string }[];
}

export interface PurchaseOverview {
  trend: { month: string; totalTiyin: string; exchangeTiyin: string; directTiyin: string; count: number }[];
  requestStatus: Record<RequestStatus, number>;
  month: { totalTiyin: string; previousTiyin: string; exchangeTiyin: string; directTiyin: string; feeTiyin: string; count: number };
  debtTiyin: string;
  open: { count: number; totalTiyin: string };
  lateDelivery: number;
  latePayment: number;
  pendingReceipts: number;
  requests: number;
  topSuppliers: { name: string; totalTiyin: string; count: number }[];
  attention: { id: string; number: string; supplierName: string; reason: string; totalTiyin: string }[];
}

export interface ItemPayload {
  name: string;
  unit: string;
  kind: 'TMZ' | 'ASSET';
  group: string | null;
  categoryCode: string;
}

export const purchasesApi = {
  lookups: () => api.get<ApiResponse<PurchaseLookups>>('/purchases/lookups'),
  overview: () => api.get<ApiResponse<PurchaseOverview>>('/purchases/overview'),
  items: (search = '') => api.get<ApiResponse<WarehouseItem[]>>(`/purchases/items?search=${encodeURIComponent(search)}`),
  createItem: (input: ItemPayload) => api.post<ApiResponse<WarehouseItem>>('/purchases/items', input),
  lastPrices: (ids: string[]) => api.get<ApiResponse<Record<string, { priceTiyin: string; date: string; supplier: string }>>>(`/purchases/last-prices?ids=${ids.join(',')}`),
  suppliers: () => api.get<ApiResponse<Supplier[]>>('/purchases/suppliers'),
  createSupplier: (input: { name: string; inn?: string | null; phone?: string | null; note?: string | null }) => api.post<ApiResponse<Supplier>>('/purchases/suppliers', input),
  updateSupplier: (id: string, input: { name?: string; inn?: string | null; phone?: string | null; note?: string | null; isActive?: boolean }) => api.patch<ApiResponse<Supplier>>(`/purchases/suppliers/${id}`, input),
  requests: (status = 'active') => api.get<ApiResponse<PurchaseRequest[]>>(`/purchases/requests?status=${status}`),
  createRequest: (input: { date?: string; departmentId: string | null; requester: string | null; title: string; note: string | null; lines: { name: string; qty: number; unit: string; itemId: string | null }[] }) =>
    api.post<ApiResponse<PurchaseRequest>>('/purchases/requests', input),
  requestStatus: (id: string, status: RequestStatus, reason?: string) => api.post<ApiResponse<PurchaseRequest>>(`/purchases/requests/${id}/status`, { status, reason }),
  list: (status: PurchaseFilter, search = '', kind = '') => api.get<ApiResponse<Purchase[]>>(`/purchases?status=${status}&search=${encodeURIComponent(search)}${kind ? `&kind=${kind}` : ''}`),
  get: (id: string) => api.get<ApiResponse<Purchase>>(`/purchases/${id}`),
  create: (input: PurchaseInput) => api.post<ApiResponse<Purchase>>('/purchases', input),
  update: (id: string, input: Partial<PurchaseInput>) => api.patch<ApiResponse<Purchase>>(`/purchases/${id}`, input),
  cancel: (id: string) => api.post<ApiResponse<Purchase>>(`/purchases/${id}/cancel`),
  addPayment: (id: string, input: { date: string; amountTiyin: number; method: string; note: string | null }) => api.post<ApiResponse<Purchase>>(`/purchases/${id}/payments`, input),
  removePayment: (id: string, paymentId: string) => api.delete<ApiResponse<Purchase>>(`/purchases/${id}/payments/${paymentId}`),
};

export const receiptsApi = {
  summary: () => api.get<ApiResponse<{ pending: number }>>('/receipts/summary'),
  list: (status = 'pending', purchaseId = '') => api.get<ApiResponse<Receipt[]>>(`/receipts?status=${status}${purchaseId ? `&purchaseId=${purchaseId}` : ''}`),
  create: (input: { purchaseId: string; note?: string | null; lines?: { itemId: string; qty: number }[] }) => api.post<ApiResponse<Receipt>>('/receipts', input),
  withdraw: (id: string) => api.post<ApiResponse<Receipt>>(`/receipts/${id}/withdraw`),
  accept: (id: string) => api.post<ApiResponse<Receipt>>(`/receipts/${id}/accept`),
  reject: (id: string, reason: string) => api.post<ApiResponse<Receipt>>(`/receipts/${id}/reject`, { reason }),
};