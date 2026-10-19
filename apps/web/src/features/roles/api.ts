'use client';

import { api, type ApiResponse } from '@/lib/api';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Rollar (umumiy hudud): nomi (administrator qo'yadi), xodimlari, dashbordlari va rol dashbordi ma'lumoti.
// ═══════════════════════════════════════════════════════════

export interface RoleItem {
  value: string;
  label: string;
  defaultLabel: string;
  description: string;
  codePrefix: string;
  sections: string[];
  dashboards: { label: string; href: string }[];
  slug: string;
  users: number;
  activeUsers: number;
}

export interface RoleActivity {
  id: string;
  at: string;
  type: 'STOCK' | 'VEHICLE' | 'POSTAL' | 'PURCHASE' | 'CASH';
  title: string;
  subtitle: string | null;
  amountTiyin: string;
  by: string | null;
  cancelled: boolean;
}

export interface RoleStat {
  stockDocs: number;
  vehicleRecords: number;
  postal: number;
  purchases: number;
  purchaseTiyin: string;
  amountTiyin: string;
  /** Buxgalter: saqlangan kunlik ma'lumotnomalar */
  cashReports?: number;
}

export interface RoleOverview {
  role: RoleItem;
  users: { id: string; fullName: string; loginCode: string | null; isActive: boolean; locked: boolean; mustChangePin: boolean; lastLoginAt: string | null }[];
  today: RoleStat;
  week: RoleStat;
  activity: RoleActivity[];
}

export const rolesApi = {
  list: () => api.get<ApiResponse<RoleItem[]>>('/roles'),
  overview: (role: string) => api.get<ApiResponse<RoleOverview>>(`/roles/${encodeURIComponent(role)}/overview`),
  rename: (role: string, label: string) => api.patch<ApiResponse<RoleItem>>(`/roles/${encodeURIComponent(role)}`, { label }),
};

// ── Chap panel va boshqa joylar uchun umumiy ro'yxat (bir marta yuklanadi, nom o'zgarsa yangilanadi) ──

let cache: RoleItem[] | null = null;
let loading: Promise<RoleItem[]> | null = null;
const EVENT = 'roles:changed';

function load(force = false): Promise<RoleItem[]> {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && loading) return loading;
  loading = rolesApi
    .list()
    .then((r) => {
      cache = r.data;
      return cache;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Rol nomi o'zgarganda — menyu va sahifalar yangi nomni oladi */
export function rolesChanged() {
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

export function useRoles(enabled = true): RoleItem[] {
  const [roles, setRoles] = useState<RoleItem[]>(cache ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = (force: boolean) =>
      load(force)
        .then((list) => alive && setRoles(list))
        .catch(() => {
          // menyu rolsiz ham ishlaydi
        });
    void refresh(false);
    const onChange = () => void refresh(true);
    window.addEventListener(EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, [enabled]);
  return roles;
}