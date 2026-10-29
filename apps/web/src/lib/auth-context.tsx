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
import { adoptSession, api, clearToken, type ApiResponse } from './api';
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
  BOLIM_RAHBARI: { home: '/kpi/ish-stoli', pages: ['/kpi'], sections: ['KPI'] },
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
    // Sessiya: cookie (yoki zaxira token) — tekshiruv to'g'ridan-to'g'ri (401 bo'lsa kirish sahifasiga o'tkazmaydi:
    // ochiq sahifalar, masalan telefondagi imzo sahifasi ham shu qobiqda)
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
    let token: string | null = null;
    try {
      token = window.localStorage.getItem('korxona_token');
    } catch {
      token = null;
    }
    fetch(`${base}/auth/me`, { credentials: 'include', headers: { 'X-Requested-With': 'korxona', ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
      .then(async (r) => {
        if (r.ok) setUser(((await r.json()) as ApiResponse<User>).data);
        else if (r.status === 401) clearToken();
      })
      .catch(() => {
        // tarmoq xatosi — token saqlanadi, keyinroq qayta tekshiriladi
      })
      .finally(() => setReady(true));
  }, []);

  /** Kirish / PIN almashtirishdan keyin: cookie ishlasa — token brauzerda saqlanmaydi */
  const applySession = useCallback((result: LoginResult) => {
    setUser(result.user);
    void adoptSession(result.accessToken);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post<ApiResponse<LoginResult>>('/auth/login', {
      username,
      password,
    });
    await adoptSession(response.data.accessToken);
    setUser(response.data.user);
    // Yo'naltirishni chaqiruvchi sahifa hal qiladi
    return response.data.user;
  }, []);

  const codeLogin = useCallback(async (code: string, pin: string) => {
    const response = await api.post<ApiResponse<LoginResult>>('/auth/code-login', { code, pin });
    await adoptSession(response.data.accessToken);
    setUser(response.data.user);
    return response.data.user;
  }, []);

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
    {
      // Serverda sessiya va cookie yopiladi
      const done = api.post('/auth/logout').catch(() => null);
      void Promise.race([done, new Promise((r) => setTimeout(r, 1500))]).finally(() => {
        clearToken();
        setUser(null);
        window.location.assign(new URL('/kirish', window.location.origin).href);
      });
      return;
    }
    clearToken();
    setUser(null);
    // To'liq qayta yuklash - barcha holat tozalanadi
    window.location.assign(new URL('/kirish', window.location.origin).href);
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