import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xodim harakati zanjiri (/api/employees/chain…): har oy qayerda bo'lgani, manbalar, harakatlar va «Nazorat».
// ═══════════════════════════════════════════════════════════

export type ChainIssueType = 'CONFLICT' | 'NO_PLACE' | 'OUT_OF_RANGE' | 'REGISTRY_STALE';
export type ChainSource = 'FIX' | 'PLACEMENT' | 'RESULTS' | 'REGISTRY';

export const SOURCE_LABEL: Record<ChainSource, string> = {
  FIX: 'ish haqi tarkibi tuzatishi',
  PLACEMENT: 'joylashuv davri',
  RESULTS: 'natijalar fayli',
  REGISTRY: 'xodimlar reestri',
};

export interface ChainReviewed {
  at: string;
  by: string;
  note: string | null;
}

export interface ChainReport {
  from: string;
  to: string;
  months: { period: string; placed: number; paid: number; moves: number; issues: number }[];
  summary: Record<ChainIssueType, { label: string; open: number; reviewed: number }>;
  issues: { pinfl: string; fullName: string; period: string; type: ChainIssueType; detail: string; effective: string | null; reviewed: ChainReviewed | null }[];
  moves: { pinfl: string; fullName: string; period: string; from: string; to: string; source: ChainSource | null }[];
  totals: { issues: number; moves: number };
}

export interface ChainTimeline {
  pinfl: string;
  fullName: string;
  position: string | null;
  hired: string | null;
  fired: string | null;
  isActive: boolean;
  registry: string;
  segments: { from: string; to: string; place: string; months: number; sources: ChainSource[] }[];
  rows: {
    period: string;
    paid: boolean;
    results: string | null;
    placement: string | null;
    fix: string | null;
    effective: string | null;
    source: ChainSource | null;
    issues: { type: ChainIssueType; detail: string; reviewed: ChainReviewed | null }[];
  }[];
}

export const chainApi = {
  report: (from: string, to: string) => api.get<ApiResponse<ChainReport>>('/employees/chain/report', { params: { from, to } }),
  timeline: (pinfl: string, from: string, to: string) => api.get<ApiResponse<ChainTimeline>>(`/employees/${encodeURIComponent(pinfl)}/chain`, { params: { from, to } }),
  review: (body: { pinfl: string; period: string; type: ChainIssueType; note?: string; undo?: boolean }) => api.put<ApiResponse<{ key: string; reviewed: boolean }>>('/employees/chain/review', body),
};
