import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Global qidiruv — backend (apps/api/src/modules/search) bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export interface SearchEntry {
  id: string;
  title: string;
  subtitle: string;
  period?: string;
  section?: 'DOIMIY' | 'BOSHQA';
  amountTiyin?: string;
}

export interface SearchResult {
  query: string;
  employees: SearchEntry[];
  incomes: SearchEntry[];
  expenses: SearchEntry[];
  vehicles: SearchEntry[];
  leases: SearchEntry[];
  reactions: SearchEntry[];
  controls: SearchEntry[];
}

export const searchApi = {
  query: (q: string) => api.get<ApiResponse<SearchResult>>('/search', { params: { q } }),
};

/** Topilgan yozuvga olib boradigan sahifa */
export function entryHref(group: keyof Omit<SearchResult, 'query'>, e: SearchEntry, q: string): string {
  const query = encodeURIComponent(q);
  switch (group) {
    case 'employees':
      return `/xodimlar?q=${encodeURIComponent(e.title)}`;
    case 'incomes':
      return `/daromadlar/${e.section === 'BOSHQA' ? 'boshqa' : 'doimiy'}?period=${e.period}&q=${query}`;
    case 'expenses':
      return `/xarajatlar/${e.section === 'BOSHQA' ? 'boshqa' : 'doimiy'}?period=${e.period}&q=${query}`;
    case 'vehicles':
      return '/xarajatlar/mashinalar';
    case 'leases':
      return `/xarajatlar/ijara?lease=${e.id}`;
    case 'reactions':
      return `/munosabat/${e.id}`;
    case 'controls':
      return '/nazorat';
  }
}