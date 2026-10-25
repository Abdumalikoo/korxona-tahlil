/**
 * Backend bilan ishlash uchun yagona klient.
 *
 * Barcha so'rovlar shu yerdan o'tadi - token biriktirish,
 * xatolarni tarjima qilish va sessiya tugashini ushlash
 * bir joyda hal qilinadi.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const TOKEN_KEY = 'korxona_token';

// ─────────── Sessiya ───────────
//
// Asosiy usul — httpOnly cookie (server o'rnatadi; JavaScript tokenni ko'rmaydi, XSS o'g'irlay olmaydi).
// Brauzer cookie'ni yubormaydigan o'rnatishda (web va API boshqa saytlarda) — zaxira: token localStorage'da.
// Qaysi biri ishlashini kirishda web o'zi tekshiradi (adoptSession).

/** API'ga har so'rovda: cookie yuborilsin va CSRF sarlavhasi bo'lsin */
export const API_HEADERS = { 'X-Requested-With': 'korxona' } as const;

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // brauzer xotirasi yopiq — cookie bilan ishlaydi
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // e'tiborsiz
  }
}

/**
 * Kirgandan keyin: cookie ishlayaptimi (tokensiz /auth/me). Ishlasa — token brauzerda saqlanmaydi.
 * Ishlamasa (masalan web va API boshqa domenda) — zaxira sifatida token saqlanadi.
 */
export async function adoptSession(accessToken: string): Promise<'cookie' | 'token'> {
  try {
    const r = await fetch(`${BASE_URL}/auth/me`, { credentials: 'include', headers: { ...API_HEADERS } });
    if (r.ok) {
      clearToken();
      return 'cookie';
    }
  } catch {
    // tarmoq — pastda zaxira
  }
  setToken(accessToken);
  return 'token';
}

/**
 * Boshqa joylardagi to'g'ridan-to'g'ri fetch (fayl yuklab olish, Excel yuklash) ham cookie va CSRF sarlavhasi bilan ketsin.
 * Faqat API manziliga; boshqa manzillarga tegmaydi.
 */
if (typeof window !== 'undefined' && !(window as unknown as { __ktFetch?: boolean }).__ktFetch) {
  (window as unknown as { __ktFetch?: boolean }).__ktFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(BASE_URL)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', API_HEADERS['X-Requested-With']);
      return original(input, { ...init, headers, credentials: init?.credentials ?? 'include' });
    }
    return original(input, init);
  };
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
  params?: object;
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
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...API_HEADERS,
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

  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),

  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};