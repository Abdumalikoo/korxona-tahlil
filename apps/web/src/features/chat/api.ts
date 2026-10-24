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

// ─────────── Chat kodi: kirish tokeni (shu brauzer oynasi uchun, muddati bilan) ───────────

export interface ChatPinRequire {
  use: boolean;
  save: boolean;
  newChat: boolean;
}

const TOKEN_KEY = 'chat.source.token';
let token: string | null = null;
export function chatToken(): string | null {
  if (token) return token;
  try {
    token = window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}
export function setChatToken(t: string | null) {
  token = t;
  try {
    if (t) window.sessionStorage.setItem(TOKEN_KEY, t);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* brauzer xotirasi yo'q — faqat shu sahifada */
  }
}
const h = (code?: string) => ({ headers: { ...(chatToken() ? { 'X-Chat-Token': chatToken()! } : {}), ...(code ? { 'X-Chat-Code': code } : {}) } });

/** Server javobi: chat qulflangan (kirish kodi kerak) yoki shu amal uchun kod kerak */
export const isLocked = (msg: string) => msg.startsWith('CHAT_LOCKED');
export const needsCode = (msg: string) => msg.startsWith('CHAT_CODE');
export const cleanMsg = (msg: string) => msg.replace(/^CHAT_(LOCKED|CODE):\s*/, '');

export const chatPinApi = {
  status: () => api.get<ApiResponse<{ require: ChatPinRequire; ttlMinutes: number; unlocked: boolean }>>('/source-chat/pin/status', h()),
  unlock: (code: string) => api.post<ApiResponse<{ token: string; expiresAt: string }>>('/source-chat/pin/unlock', { code }),
  config: () => api.get<ApiResponse<{ require: ChatPinRequire; ttlMinutes: number; isDefault: boolean; updatedAt: string | null }>>('/source-chat/pin'),
  update: (body: { currentCode: string; newCode?: string; require?: Partial<ChatPinRequire>; ttlMinutes?: number }) =>
    api.put<ApiResponse<{ require: ChatPinRequire; ttlMinutes: number; isDefault: boolean; updatedAt: string | null }>>('/source-chat/pin', body),
};

export const sourceChatApi = {
  ask: (text: string, context: ChatContext, threadId: string | null, code?: string) =>
    api.post<ApiResponse<ChatAnswer & { threadId: string; thread: ChatThread }>>('/source-chat/ask', { text, context, threadId, code }, h()),
  threads: (q?: string) => api.get<ApiResponse<ChatThread[]>>('/source-chat/threads', { params: q ? { q } : undefined, ...h() }),
  thread: (id: string) => api.get<ApiResponse<ChatThread & { items: ChatAnswer[] }>>(`/source-chat/threads/${enc(id)}`, h()),
  create: (code?: string) => api.post<ApiResponse<ChatThread>>('/source-chat/threads', { code }, h()),
  update: (id: string, body: { title?: string; pinned?: boolean }) => api.patch<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}`, body, h()),
  remove: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/source-chat/threads/${enc(id)}`, h()),
  removeAll: (keepPinned: boolean) => api.delete<ApiResponse<{ success: true; deleted: number }>>(`/source-chat/threads${keepPinned ? '?keepPinned=1' : ''}`, h()),
  clear: (id: string) => api.post<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}/clear`, undefined, h()),
  removeItem: (id: string, itemId: string) => api.delete<ApiResponse<ChatThread>>(`/source-chat/threads/${enc(id)}/items/${enc(itemId)}`, h()),
  itemText: (id: string, itemId: string) => api.get<ApiResponse<{ text: string }>>(`/source-chat/threads/${enc(id)}/items/${enc(itemId)}/text`, h()),
  saved: () => api.get<ApiResponse<SavedAnswer[]>>('/source-chat/saved', h()),
  save: (threadId: string, itemId: string, code?: string) => api.post<ApiResponse<SavedAnswer>>('/source-chat/saved', { threadId, itemId, code }, h()),
  updateSaved: (id: string, note: string) => api.patch<ApiResponse<SavedAnswer>>(`/source-chat/saved/${enc(id)}`, { note }, h()),
  unsave: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/source-chat/saved/${enc(id)}`, h()),
  clearSaved: () => api.delete<ApiResponse<{ success: true }>>('/source-chat/saved', h()),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function download(path: string, fallback: string, code?: string): Promise<void> {
  const auth = getToken();
  const response = await fetch(`${BASE}${path}`, { headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...h(code).headers } });
  if (!response.ok) {
    let msg = "Faylni yuklab bo'lmadi";
    try {
      const j = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
      const m = j.error?.message ?? j.message;
      msg = (Array.isArray(m) ? m[0] : m) ?? msg;
    } catch {
      /* matn emas */
    }
    throw new Error(msg);
  }
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

export const exportThread = (id: string, code?: string) => download(`/source-chat/threads/${enc(id)}/export`, 'Chat.xlsx', code);
export const exportSaved = (ids?: string[], code?: string) => download(`/source-chat/saved/export${ids?.length ? `?ids=${enc(ids.join(','))}` : ''}`, 'Chat-saqlanganlar.xlsx', code);