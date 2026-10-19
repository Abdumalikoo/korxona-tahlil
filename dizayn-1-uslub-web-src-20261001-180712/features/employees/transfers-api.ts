import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xodim o'tkazmalari — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

/** Xodimning bir oydagi joyi */
export interface TransferPlace {
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: string;
}

/** region — boshqa hududga, district — boshqa tumanga, type — shtat ↔ shartnoma */
export type TransferKind = 'region' | 'district' | 'type';

export interface EmployeeTransfer {
  pinfl: string;
  fullName: string;
  /** Yangi joyda ishlay boshlagan oy */
  period: string;
  /** Eski joyda oxirgi ma'lum oy */
  previousPeriod: string;
  kinds: TransferKind[];
  from: TransferPlace;
  to: TransferPlace;
}

export interface RegionMovement {
  regionCode: number;
  regionName: string;
  arrived: number;
  left: number;
  net: number;
}

export interface TransferList {
  from: string | null;
  to: string | null;
  total: number;
  transfers: EmployeeTransfer[];
  regions: RegionMovement[];
}

export interface EmployeeTimeline {
  employee: { pinfl: string; fullName: string; isActive: boolean; current: TransferPlace | null };
  months: (TransferPlace & { period: string })[];
  transfers: EmployeeTransfer[];
}

// ═══════════════════════════════════════════════════════════
// Yordamchilar
// ═══════════════════════════════════════════════════════════

export const TRANSFER_KIND_LABELS: Record<TransferKind, string> = {
  region: 'Hudud',
  district: 'Tuman',
  type: 'Ish turi',
};

export function employmentLabel(type: string): string {
  return type === 'SHARTNOMA' ? 'Shartnoma' : 'Shtat';
}

/** "Buxoro · G'ijduvon" */
export function placeLabel(place: TransferPlace): string {
  return place.districtName ? `${place.regionName} · ${place.districtName}` : place.regionName;
}

/** O'tkazmaning qisqa tavsifi: "Andijon → Buxoro" yoki "Shtat → Shartnoma" */
export function transferSummary(transfer: EmployeeTransfer): string {
  const parts: string[] = [];
  if (transfer.kinds.includes('region')) {
    parts.push(`${transfer.from.regionName} → ${transfer.to.regionName}`);
  } else if (transfer.kinds.includes('district')) {
    parts.push(`${transfer.from.districtName ?? '—'} → ${transfer.to.districtName ?? '—'}`);
  }
  if (transfer.kinds.includes('type')) {
    parts.push(`${employmentLabel(transfer.from.employmentType)} → ${employmentLabel(transfer.to.employmentType)}`);
  }
  return parts.join(', ');
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const transfersApi = {
  /** from / to — "YYYY-MM" (o'tkazma oyi) */
  list: (params: { from?: string; to?: string; regionCode?: number }) =>
    api.get<ApiResponse<TransferList>>('/employee-transfers', { params }),

  /** Har bir xodimning oxirgi o'tkazmasi: { [pinfl]: EmployeeTransfer } */
  latest: () => api.get<ApiResponse<Record<string, EmployeeTransfer>>>('/employee-transfers/latest'),

  employee: (pinfl: string) =>
    api.get<ApiResponse<EmployeeTimeline>>(`/employee-transfers/employee/${pinfl}`),
};
