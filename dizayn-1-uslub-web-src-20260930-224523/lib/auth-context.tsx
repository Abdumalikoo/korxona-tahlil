'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react';
import { api, clearToken, getToken, setToken, type ApiResponse } from './api';
import type { LoginResult, User } from './types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();

    if (!token) {
      setReady(true);
      return;
    }

    api
      .get<ApiResponse<User>>('/auth/me')
      .then((response) => setUser(response.data))
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post<ApiResponse<LoginResult>>('/auth/login', {
      username,
      password,
    });

    setToken(response.data.accessToken);
    setUser(response.data.user);
    // Yo'naltirishni chaqiruvchi sahifa hal qiladi
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    // To'liq qayta yuklash - barcha holat tozalanadi
    window.location.href = '/kirish';
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, ready, login, logout, isAdmin: user?.role === 'ADMIN' }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth faqat AuthProvider ichida ishlatiladi');
  }
  return context;
}
