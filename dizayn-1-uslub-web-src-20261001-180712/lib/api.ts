/**
 * Backend bilan ishlash uchun yagona klient.
 *
 * Barcha so'rovlar shu yerdan o'tadi - token biriktirish,
 * xatolarni tarjima qilish va sessiya tugashini ushlash
 * bir joyda hal qilinadi.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const TOKEN_KEY = 'korxona_token';

// ─────────── Token ───────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

// ─────────── Xatolar ───────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Sessiya tugagan yoki token yaroqsiz */
  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /** Ruxsat yo'q - kuzatuvchi admin amalini bajarmoqchi */
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string | string[];
    statusCode?: number;
  };
}

// ─────────── So'rov ───────────

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** So'rov parametrlari - undefined qiymatlar tashlab yuboriladi */
  params?: Record<string, string | number | boolean | undefined | null>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, params, headers, ...rest } = options;

  let url = `${BASE_URL}${path}`;

  if (params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    const query = search.toString();
    if (query) url += `?${query}`;
  }

  const token = getToken();

  const response = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    let message = 'Serverda xatolik yuz berdi';
    let code: string | undefined;

    try {
      const parsed = (await response.json()) as ApiErrorBody;
      const raw = parsed.error?.message;
      // class-validator bir nechta xato qaytarishi mumkin
      message = Array.isArray(raw) ? (raw[0] ?? message) : (raw ?? message);
      code = parsed.error?.code;
    } catch {
      // Javob JSON emas - standart xabar qoladi
    }

    // Sessiya tugagan - tokenni tozalaymiz va kirish sahifasiga qaytaramiz
    if (response.status === 401 && typeof window !== 'undefined') {
      clearToken();
      if (!window.location.pathname.startsWith('/kirish')) {
        window.location.href = '/kirish';
      }
    }

    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ─────────── Umumiy javob tuzilmalari ───────────

export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    [key: string]: unknown;
  };
}

// ─────────── Metodlar ───────────

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
