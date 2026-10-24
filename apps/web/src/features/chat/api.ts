import { api, getToken, type ApiResponse } from '@/lib/api';
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

export interface ChatThread {
  id: string;
  title: string;
  titled: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  count: number;
}

export interface SavedAnswer {
  id: string;
  note: string | null;
  savedAt: string;
  threadId: string | null;
  threadTitle: string | null;
  answer: ChatAnswer;
}

const enc = encodeURIComponent;

export const sourceChatApi = {
  ask: (text: string, context: ChatContext, threadId: string | null) =>
    api.post<ApiResponse<ChatAnswer & { threadId: string; thread: ChatThread }>>('/source-chat/ask', { text, context, threadId }),
  threads: (q?: string) => api.get<ApiResponse<ChatThread[]>>('/source-chat/threads', { params: q ? { q } : undefined }),
  thread: (id: string) => api.get<ApiResponse<ChatThread & { items: ChatAnswer[] }>>(`/source-chat/threads/${enc(id)}`),
  create: () => api.post<ApiResponse<ChatThread>>('/source-chat/threads', {}),
  update: (id: string, body: { title?: string; pinned?: boolean }) => api.patch<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}`, body),
  remove: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/source-chat/threads/${enc(id)}`),
  removeAll: (keepPinned: boolean) => api.delete<ApiResponse<{ success: true; deleted: number }>>(`/source-chat/threads${keepPinned ? '?keepPinned=1' : ''}`),
  clear: (id: string) => api.post<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}/clear`),
  removeItem: (id: string, itemId: string) => api.delete<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}/items/${enc(itemId)}`),
  itemText: (id: string, itemId: string) => api.get<ApiResponse<{ text: string }>>(`/source-chat/threads/${enc(id)}/items/${enc(itemId)}/text`),
  saved: () => api.get<ApiResponse<SavedAnswer[]>>('/source-chat/saved'),
  save: (threadId: string, itemId: string, note?: string) => api.post<ApiResponse<SavedAnswer>>('/source-chat/saved', { threadId, itemId, note }),
  updateSaved: (id: string, note: string) => api.patch<ApiResponse<SavedAnswer>>(`/source-chat/saved/${enc(id)}`, { note }),
  unsave: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/source-chat/saved/${enc(id)}`),
  clearSaved: () => api.delete<ApiResponse<{ success: true }>>('/source-chat/saved'),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function download(path: string, fallback: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error("Faylni yuklab bo'lmadi");
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ? decodeURIComponent(match[1]) : fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const exportThread = (id: string) => download(`/source-chat/threads/${enc(id)}/export`, 'Chat.xlsx');
export const exportSaved = (ids?: string[]) => download(`/source-chat/saved/export${ids?.length ? `?ids=${enc(ids.join(','))}` : ''}`, 'Chat-saqlanganlar.xlsx');