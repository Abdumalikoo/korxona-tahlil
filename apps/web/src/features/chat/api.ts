import { api, type ApiResponse } from '@/lib/api';
import type { HrPersonCard } from '@/features/hr-sheets/api';

// ═══════════════════════════════════════════════════════════
// Chat › Manba chati: /api/source-chat/… — javob faqat tizim manbalaridan (faqat administrator).
// ═══════════════════════════════════════════════════════════

export interface ChatPeriod {
  from: string;
  to: string;
  label: string;
}

/** Oldingi savoldan qolgan kontekst — davom savollari uchun («fevraldagi-chi?», «uning ish haqi») */
export interface ChatContext {
  intent?: string | null;
  kind?: string | null;
  pinfl?: string | null;
  units?: string[];
  region?: number | null;
  dept?: string | null;
  category?: string | null;
  period?: ChatPeriod | null;
}

export type ChatBlock =
  | { type: 'text'; text: string; tone?: 'muted' | 'warn' }
  | { type: 'metrics'; items: { label: string; value: string; sub?: string; tone?: 'income' | 'expense' | 'warn' | 'brand' }[] }
  | { type: 'table'; title?: string; columns: { key: string; label: string; align?: 'right' }[]; rows: Record<string, string | null>[]; total?: Record<string, string | null>; note?: string }
  | { type: 'bars'; title?: string; items: { label: string; value: number; display: string; sub?: string }[] }
  | { type: 'person'; data: HrPersonCard }
  | { type: 'choices'; title: string; items: { label: string; sub?: string; ask: string }[] };

export interface ChatAnswer {
  id: string;
  question: string;
  at: string;
  blocks: ChatBlock[];
  understood: { label: string; value: string }[];
  sources: string[];
  suggestions: string[];
  context: ChatContext;
}

export const sourceChatApi = {
  ask: (text: string, context: ChatContext) => api.post<ApiResponse<ChatAnswer>>('/source-chat/ask', { text, context }),
  history: () => api.get<ApiResponse<ChatAnswer[]>>('/source-chat/history'),
  clear: () => api.delete<ApiResponse<{ success: true }>>('/source-chat/history'),
};