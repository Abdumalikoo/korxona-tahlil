import { api, type ApiResponse } from '@/lib/api';
import type { UserRole } from '@/lib/types';

// Sozlamalar › Foydalanuvchilar (faqat administrator) — backend modules/users bilan bir xil turlar

export interface UserRow {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  roleLabel: string;
  /** ID kod bilan kiradigan ishchi rolmi */
  worker: boolean;
  loginCode: string | null;
  sections: string[] | null;
  isActive: boolean;
  /** Admin bergan PIN hali o'zgartirilmagan */
  mustChangePin: boolean;
  /** Xato PIN tufayli yopilgan bo'lsa — qachongacha */
  lockedUntil: string | null;
  failedAttempts: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleOption {
  value: UserRole;
  label: string;
  description: string;
  codePrefix: string;
  sections: string[];
}

/** Tarix: kirishlar, xato PIN, PIN berish, bloklash */
export interface UserEvent {
  id: string;
  at: string;
  action: string;
  summary: string;
  by: string;
  /** O'zi bajargan (kirish, PIN o'zgartirish) */
  self: boolean;
}

/** Yangi foydalanuvchi yoki PIN tiklash natijasi — PIN faqat shu javobda ko'rinadi */
export interface Credentials {
  user: UserRow;
  pin: string;
}

export const usersApi = {
  list: () => api.get<ApiResponse<UserRow[]>>('/users'),
  roles: () => api.get<ApiResponse<RoleOption[]>>('/users/roles'),
  create: (payload: { fullName: string; role: string; pin?: string; mustChange?: boolean }) => api.post<ApiResponse<Credentials>>('/users', payload),
  update: (id: string, payload: { fullName?: string; isActive?: boolean; loginCode?: string }) => api.patch<ApiResponse<UserRow>>(`/users/${id}`, payload),
  resetPin: (id: string, pin?: string, mustChange = true) => api.post<ApiResponse<Credentials>>(`/users/${id}/reset-pin`, { ...(pin ? { pin } : {}), mustChange }),
  history: (id: string) => api.get<ApiResponse<UserEvent[]>>(`/users/${id}/history`),
  unlock: (id: string) => api.post<ApiResponse<UserRow>>(`/users/${id}/unlock`),
};