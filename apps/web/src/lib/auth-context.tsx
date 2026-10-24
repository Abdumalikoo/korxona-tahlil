'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react';
import { api, ApiError, clearToken, getToken, setToken, type ApiResponse } from './api';
import type { LoginResult, User } from './types';

// ═══════════════════════════════════════════════════════════
// Kirgan foydalanuvchi va uning huquqlari.
//  • Administrator — hamma narsa (ko'rish va kiritish)
//  • Kuzatuvchi — hamma narsani ko'radi, kirita olmaydi
//  • Ishchi rollar (Omborchi …) — ID kod + PIN bilan kiradi, faqat o'z bo'limi:
//    user.access.pages ichidagi sahifalarni ko'radi va to'ldiradi.
// Cheklov serverda ham bor (AccessGuard) — bu yerdagisi faqat ekran uchun.
// ═══════════════════════════════════════════════════════════

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<User>;
  /** ID kod + 6 xonali PIN (ishchi rollar) */
  codeLogin: (code: string, pin: string) => Promise<User>;
  /** PIN o'zgargach server yangi token beradi — shu bilan sessiya yangilanadi */
  applySession: (result: LoginResult) => void;
  logout: () => void;
  isAdmin: boolean;
  /** ID kod bilan kiradigan ishchi rolmi (Omborchi …) */
  isWorker: boolean;
  /** Shu sahifani ko'ra oladimi */
  canView: (path: string) => boolean;
  /** Shu sahifada ma'lumot kirita oladimi (admin — hamma joyda, ishchi — o'z bo'limida) */
  canWrite: (path: string) => boolean;
  /** Kirgandan keyin ochiladigan sahifa */
  home: string;
  /** Administrator hozir qaysi rol sifatida ishlayapti (ID kod/PIN'siz) — yo'q bo'lsa null */
  actingRole: string | null;
  /** Administrator rol ichiga kiradi (shu brauzer oynasida) va o'sha rolning bosh sahifasi qaytariladi */
  enterRole: (role: string) => string | null;
  /** Rol ichidan administrator hududiga qaytadi */
  leaveRole: () => void;
}

const ACTING_KEY = 'acting-role';

/** Administrator kira oladigan rollar: ularning ish bo'limi (serverdagi role-access bilan bir xil) */
export const ROLE_ENTRY: Record<string, { home: string; pages: string[]; sections: string[] }> = {
  SKLADCHI: { home: '/ombor/ish-stoli', pages: ['/ombor', '/mashinalar'], sections: ['Ombor', 'Mashinalar'] },
  XARIDCHI: { home: '/xarid/ish-stoli', pages: ['/xarid'], sections: ['Xarid'] },
  BUXGALTER: { home: '/buxgalteriya/ish-stoli', pages: ['/buxgalteriya'], sections: ['Buxgalteriya'] },
  HUDUDCHI: { home: '/hudud/ish-stoli', pages: ['/hudud'], sections: ['Hududlar'] },
};

const AuthContext = createContext<AuthState | null>(null);

function under(path: string, prefix: string): boolean {
  const clean = path.split('?')[0] ?? path;
  return clean === prefix || clean.startsWith(`${prefix}/`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(ACTING_KEY);
      if (saved && ROLE_ENTRY[saved]) setActing(saved);
    } catch {
      // sessionStorage yopiq bo'lsa
    }
    const token = getToken();

    if (!token) {
      setReady(true);
      return;
    }

    api
      .get<ApiResponse<User>>('/auth/me')
      .then((response) => setUser(response.data))
      .catch((error: unknown) => {
        // Faqat sessiya haqiqatan tugagan bo'lsa (401) chiqariladi; tarmoq/server xatosida token saqlanadi
        if (error instanceof ApiError && error.isUnauthorized) clearToken();
      })
      .finally(() => setReady(true));
  }, []);

  const applySession = useCallback((result: LoginResult) => {
    setToken(result.accessToken);
    setUser(result.user);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post<ApiResponse<LoginResult>>('/auth/login', {
      username,
      password,
    });
    applySession(response.data);
    // Yo'naltirishni chaqiruvchi sahifa hal qiladi
    return response.data.user;
  }, [applySession]);

  const codeLogin = useCallback(async (code: string, pin: string) => {
    const response = await api.post<ApiResponse<LoginResult>>('/auth/code-login', { code, pin });
    applySession(response.data);
    return response.data.user;
  }, [applySession]);

  const enterRole = useCallback((role: string): string | null => {
    const entry = ROLE_ENTRY[role];
    if (!entry) return null;
    try {
      window.sessionStorage.setItem(ACTING_KEY, role);
    } catch {
      // sessionStorage yopiq bo'lsa — xotirada
    }
    setActing(role);
    return entry.home;
  }, []);

  const leaveRole = useCallback(() => {
    try {
      window.sessionStorage.removeItem(ACTING_KEY);
    } catch {
      // e'tiborsiz
    }
    setActing(null);
  }, []);

  const logout = useCallback(() => {
    try {
      window.sessionStorage.removeItem(ACTING_KEY);
    } catch {
      // e'tiborsiz
    }
    // Serverda ham yopiladi: token boshqa joyda saqlanib qolgan bo'lsa ham yaroqsiz bo'ladi.
    // Javob kutilmaydi (1,5 soniya) — tarmoq yo'q bo'lsa ham foydalanuvchi chiqadi.
    if (getToken()) {
      const done = api.post('/auth/logout').catch(() => null);
      void Promise.race([done, new Promise((r) => setTimeout(r, 1500))]).finally(() => {
        clearToken();
        setUser(null);
        window.location.href = '/kirish';
      });
      return;
    }
    clearToken();
    setUser(null);
    // To'liq qayta yuklash - barcha holat tozalanadi
    window.location.href = '/kirish';
  }, []);

  const value = useMemo<AuthState>(() => {
    const isAdmin = user?.role === 'ADMIN';
    // Administrator rol ichida: o'sha rolning ish bo'limi ochiladi (server administratorga hammasini ruxsat beradi)
    const actingEntry = isAdmin && acting ? (ROLE_ENTRY[acting] ?? null) : null;
    const access = actingEntry ?? user?.access ?? null;
    const effectiveUser = user && actingEntry ? { ...user, access: actingEntry, mustChangePin: false } : user;
    const isWorker = Boolean(access);
    const canView = (path: string) => (!user ? false : !access ? true : access.pages.some((p) => under(path, p)));
    const canWrite = (path: string) => (!user ? false : isAdmin ? true : access ? access.pages.some((p) => under(path, p)) : false);
    return {
      user: effectiveUser,
      ready,
      login,
      codeLogin,
      applySession,
      logout,
      isAdmin,
      isWorker,
      canView,
      canWrite,
      home: access?.home ?? '/',
      actingRole: actingEntry ? acting : null,
      enterRole,
      leaveRole,
    };
  }, [user, ready, login, codeLogin, applySession, logout, acting, enterRole, leaveRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth faqat AuthProvider ichida ishlatiladi');
  }
  return context;
}