import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Kontragentlar — schyot-faktura va bank ko'chirmasidan yagona karta: /api/counterparties/…
// ═══════════════════════════════════════════════════════════

export type CpRole = 'SUPPLIER' | 'CLIENT';
export type CpIssue = 'UNPAID' | 'NO_INVOICE' | 'NO_BANK';

export interface CpService {
  label: string;
  totalTiyin: string;
  kindLabel: string;
  dir: 'OUT' | 'IN';
  src: 'INVOICE' | 'BANK';
}

export interface Counterparty {
  inn: string;
  name: string;
  alias: string | null;
  kind: string;
  kindLabel: string;
  roles: CpRole[];
  services: CpService[];
  invoicedOutTiyin: string;
  paidOutTiyin: string;
  balanceOutTiyin: string;
  invoicedInTiyin: string;
  receivedInTiyin: string;
  balanceInTiyin: string;
  invoices: number;
  payments: number;
  sources: ('INVOICE' | 'BANK')[];
  firstDate: string | null;
  lastDate: string | null;
  months: number;
}

export interface CpList {
  from: string | null;
  to: string | null;
  count: number;
  totals: { invoicedOutTiyin: string; paidOutTiyin: string; invoicedInTiyin: string; receivedInTiyin: string };
  rows: Counterparty[];
}

export interface CpCard extends Counterparty {
  byMonth: { period: string; label: string; invoicedOutTiyin: string; paidOutTiyin: string; invoicedInTiyin: string; receivedInTiyin: string; balanceOutTiyin: string; balanceInTiyin: string }[];
  contracts: { number: string; date: string | null; invoices: number; totalTiyin: string; lastDate: string }[];
  branches: { name: string; totalTiyin: string }[];
  documents: { src: 'INVOICE' | 'BANK'; dir: 'OUT' | 'IN'; date: string; period: string; number: string; amountTiyin: string; text: string; ikpu: string | null; status: string | null; contract: string | null; kindLabel: string }[];
}

export const counterpartiesApi = {
  list: (p: { from: string; to: string; q?: string; role?: CpRole | null; issue?: CpIssue | null }) =>
    api.get<ApiResponse<CpList>>('/counterparties', { params: { from: p.from, to: p.to, ...(p.q ? { q: p.q } : {}), ...(p.role ? { role: p.role } : {}), ...(p.issue ? { issue: p.issue } : {}) } }),
  card: (inn: string, from: string, to: string) => api.get<ApiResponse<CpCard>>(`/counterparties/${encodeURIComponent(inn)}`, { params: { from, to } }),
};
