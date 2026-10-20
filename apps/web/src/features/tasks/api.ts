import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Topshiriqlar (xodimga muddatli ish) va Telegram bot.
// ═══════════════════════════════════════════════════════════

export type TaskStatus = 'OPEN' | 'DONE' | 'CANCELLED';
export type TaskFilter = 'active' | 'overdue' | 'done' | 'cancelled';

export interface TaskReminder {
  id: string;
  /** -1 — topshiriq berilganda darhol; 0 — muddat vaqtida; N — muddatdan N soat oldin */
  hoursBefore: number;
  dueAt: string;
  sentAt: string | null;
  error: string | null;
  attempts: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  pinfl: string;
  employeeName: string;
  position: string | null;
  linked: boolean;
  remindHours: number[];
  status: TaskStatus;
  overdue: boolean;
  createdByName: string | null;
  createdAt: string;
  doneAt: string | null;
  reminders: TaskReminder[];
}

export interface TaskInput {
  title: string;
  description: string | null;
  /** "YYYY-MM-DDTHH:mm" — Toshkent vaqti */
  deadline: string;
  pinfl: string;
  remindHours: number[];
  sendNow?: boolean;
}

export interface TaskEmployee {
  pinfl: string;
  fullName: string;
  position: string | null;
  linked: boolean;
}

export interface TelegramStatus {
  configured: boolean;
  username: string | null;
  polling: boolean;
  lastError: string | null;
  linked: number;
}

export interface TelegramLinkItem {
  pinfl: string;
  fullName: string;
  position: string | null;
  username: string | null;
  firstName: string | null;
  linkedAt: string;
}

export interface TelegramInvite {
  url: string;
  code: string;
  expiresAt: string;
}

export const tasksApi = {
  list: (status: TaskFilter) => api.get<ApiResponse<Task[]>>(`/tasks?status=${status}`),
  employees: (search: string) => api.get<ApiResponse<TaskEmployee[]>>(`/tasks/employees?search=${encodeURIComponent(search)}`),
  create: (input: TaskInput) => api.post<ApiResponse<Task>>('/tasks', input),
  update: (id: string, input: Partial<TaskInput>) => api.patch<ApiResponse<Task>>(`/tasks/${id}`, input),
  done: (id: string) => api.post<ApiResponse<Task>>(`/tasks/${id}/done`),
  cancel: (id: string) => api.post<ApiResponse<Task>>(`/tasks/${id}/cancel`),
  reopen: (id: string) => api.post<ApiResponse<Task>>(`/tasks/${id}/reopen`),
  remind: (id: string) => api.post<ApiResponse<Task>>(`/tasks/${id}/remind`),
  remove: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/tasks/${id}`),
};

export const telegramApi = {
  status: () => api.get<ApiResponse<TelegramStatus>>('/telegram/status'),
  setToken: (token: string) => api.post<ApiResponse<TelegramStatus>>('/telegram/token', { token }),
  clearToken: () => api.delete<ApiResponse<TelegramStatus>>('/telegram/token'),
  links: () => api.get<ApiResponse<TelegramLinkItem[]>>('/telegram/links'),
  invite: (pinfl: string) => api.post<ApiResponse<TelegramInvite>>(`/telegram/links/${pinfl}`),
  unlink: (pinfl: string) => api.delete<ApiResponse<{ pinfl: string }>>(`/telegram/links/${pinfl}`),
  test: (pinfl: string) => api.post<ApiResponse<{ ok: true }>>(`/telegram/test/${pinfl}`),
  /** Dalolatnomalar arxivi guruhi: imzolangan har bir dalolatnomaning 2-nusxasi shu yerga */
  archive: () => api.get<ApiResponse<TelegramArchive | null>>('/telegram/archive'),
  archiveCode: () => api.post<ApiResponse<TelegramArchiveCode>>('/telegram/archive/code'),
  clearArchive: () => api.delete<ApiResponse<{ ok: true }>>('/telegram/archive'),
};

export interface TelegramArchive {
  chatId: string;
  title: string | null;
  setAt: string;
}

export interface TelegramArchiveCode {
  code: string;
  command: string;
  expiresAt: string;
  botUsername: string | null;
}

// ── Vaqt (Toshkent, UTC+5) ──

const TZ = 5 * 3_600_000;

/** Date → "YYYY-MM-DDTHH:mm" (Toshkent) — datetime-local maydoni uchun */
export function toLocalInput(date: Date | string): string {
  return new Date(new Date(date).getTime() + TZ).toISOString().slice(0, 16);
}

/** "15.10.2026, 18:00" */
export function fmtWhen(iso: string): string {
  const t = toLocalInput(iso);
  return `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}, ${t.slice(11, 16)}`;
}

/** Muddatgacha qolgan vaqt: "2 kun 3 soat", "45 daqiqa", "3 soat o'tdi" */
export function leftLabel(iso: string, now = Date.now()): { text: string; tone: 'ok' | 'soon' | 'late' } {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const span = d > 0 ? `${d} kun${h ? ` ${h} soat` : ''}` : h > 0 ? `${h} soat${m >= 5 ? ` ${m} daq` : ''}` : `${Math.max(1, m)} daqiqa`;
  if (ms < 0) return { text: `${span} o'tdi`, tone: 'late' };
  return { text: `${span} qoldi`, tone: ms < 24 * 3_600_000 ? 'soon' : 'ok' };
}

/** Eslatma nomi: "24 soat oldin", "Muddat vaqtida", "Darhol" */
export function reminderLabel(hours: number): string {
  if (hours < 0) return 'Darhol';
  if (hours === 0) return 'Muddat vaqtida';
  if (hours % 24 === 0) return `${hours / 24} kun oldin`;
  return `${hours} soat oldin`;
}