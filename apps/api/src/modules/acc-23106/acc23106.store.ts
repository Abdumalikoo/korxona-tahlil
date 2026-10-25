import type { PayoutKind } from './acc23106.purpose';

// 23106 ko'chirmasi — saqlash tuzilmasi (settings «acc23106.store»): oyma-oy to'lovlar va yuklashlar tarixi.

export const STORE_KEY = 'acc23106.store';

export type MatchBy = 'PINFL' | 'NAME' | null;
export type ControlState = 'OK' | 'OVER' | 'NOT_IN_TARKIB' | 'NO_TARKIB' | 'NA';

export interface PayoutRow {
  no: string;
  docDate: string;
  procDate: string | null;
  docNo: string;
  accountName: string;
  /** ИНН ustuni: 14 xonali — PINFL, 9 xonali — tashkilot */
  inn: string;
  mfo: string;
  debitTiyin: string;
  purpose: string;
  kind: PayoutKind;
  orderDate: string | null;
  orderNo: string | null;
  /** Hisoblangan oy (izohdagi oy nomi, bo'lmasa buyruq oyi, bo'lmasa — to'lov oyi) */
  accrual: string;
  /** Izohdagi F.I.Sh. */
  commentName: string | null;
  pinfl: string | null;
  fullName: string | null;
  matchBy: MatchBy;
}

export interface MonthState {
  batchId: string;
  fileName: string;
  savedAt: string;
  uploadedBy: string;
  rows: PayoutRow[];
}

export interface Batch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  rows: number;
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
}

export interface Store {
  months: Record<string, MonthState>;
  batches: Batch[];
}

export function readStore(raw: unknown): Store {
  const v = (raw ?? {}) as Partial<Store>;
  return {
    months: v.months && typeof v.months === 'object' && !Array.isArray(v.months) ? (v.months as Record<string, MonthState>) : {},
    batches: Array.isArray(v.batches) ? (v.batches as Batch[]) : [],
  };
}

