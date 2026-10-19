import { api, type ApiResponse } from '@/lib/api';

// Solishtirma › O'zgarishlar — /api/structure/regions/changes

export type ChangeKind = 'hired' | 'returned' | 'fired' | 'idle' | 'moved' | 'up' | 'down' | 'hiredUnpaid';

export interface ChangePerson {
  pinfl: string;
  fullName: string;
  position: string | null;
  kind: ChangeKind;
  unitKey: string;
  unitName: string;
  fromUnitKey: string | null;
  fromUnitName: string | null;
  previousTiyin: string;
  currentTiyin: string;
  hiredAt: string | null;
  firedAt: string | null;
}

export interface ChangeUnit {
  key: string;
  code: number;
  name: string;
  kind: 'center' | 'region';
  previousCount: number;
  currentCount: number;
  previousTiyin: string;
  currentTiyin: string;
  centerPartTiyin: string;
  hired: number;
  returned: number;
  fired: number;
  idle: number;
  movedIn: number;
  movedOut: number;
}

export interface ChangesResult {
  period: string;
  previousPeriod: string;
  periods: string[];
  hasCurrent: boolean;
  hasPrevious: boolean;
  totals: {
    currentCount: number;
    previousCount: number;
    currentTiyin: string;
    previousTiyin: string;
    regionsCount: number;
    regionsTiyin: string;
    centerCount: number;
    centerTiyin: string;
    previousRegionsCount: number;
    previousCenterCount: number;
    previousRegionsTiyin: string;
    previousCenterTiyin: string;
    centerPartTiyin: string;
  };
  counts: Record<ChangeKind, number>;
  units: ChangeUnit[];
  people: ChangePerson[];
  notes: string[];
}

export const changesApi = {
  month: (params: { month?: string; to?: string }) => api.get<ApiResponse<ChangesResult>>('/structure/regions/changes', { params }),
};