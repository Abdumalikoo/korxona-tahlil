import type { NextFunction, Request, Response } from 'express';

// ═══════════════════════════════════════════════════════════
// Sessiya cookie'si (httpOnly) — kirish tokeni brauzer JavaScript'iga ko'rinmaydi:
// sahifada begona skript ishlab qolsa ham (XSS) tokenni o'g'irlay olmaydi.
//  • HttpOnly; SameSite=Strict (boshqa saytdan yuborilgan so'rovga qo'shilmaydi); Path=/api;
//    HTTPS bo'lsa — Secure. Muddati — token muddati bilan bir xil.
//  • Bearer sarlavhasi ham ishlayveradi (eski oynalar, cookie ishlamaydigan o'rnatish — web o'zi aniqlaydi).
//  • CSRF: cookie bilan kelgan o'zgartiruvchi so'rovda «X-Requested-With» sarlavhasi shart —
//    boshqa sayt bunday sarlavhani CORS ruxsatisiz yubora olmaydi.
// ═══════════════════════════════════════════════════════════

export const AUTH_COOKIE = 'kt_session';
const CSRF_HEADER = 'x-requested-with';

export function readCookie(req: { headers?: { cookie?: string } }, name: string): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Token muddati (sekund) — JWT ichidagi exp dan */
function ttlOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') return Math.max(0, Math.floor(payload.exp - Date.now() / 1000));
  } catch {
    /* pastda standart */
  }
  return 24 * 3600;
}

const isHttps = (req: Request | undefined) => Boolean(req?.secure) || String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0]?.trim() === 'https';

export function setAuthCookie(req: Request | undefined, res: Response | undefined, token: string): void {
  if (typeof res?.cookie !== 'function') return; // to'g'ridan-to'g'ri chaqiruv (sinov) — cookie yo'q
  res.cookie(AUTH_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: isHttps(req), path: '/api', maxAge: ttlOf(token) * 1000 });
}

export function clearAuthCookie(req: Request | undefined, res: Response | undefined): void {
  if (typeof res?.clearCookie !== 'function') return;
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, sameSite: 'strict', secure: isHttps(req), path: '/api' });
}

/** Cookie'dan tokenni olish (passport-jwt uchun) */
export const cookieToken = (req: { headers?: { cookie?: string } }): string | null => readCookie(req, AUTH_COOKIE);

/** CSRF himoyasi: cookie bilan (Bearer'siz) kelgan o'zgartiruvchi so'rovda maxsus sarlavha bo'lishi shart */
export function csrfGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    if (req.headers.authorization) return next(); // Bearer — brauzer o'zi qo'shmaydi
    if (!readCookie(req, AUTH_COOKIE)) return next(); // sessiyasiz (kirish, telefon orqali imzo) — tekshiruv shart emas
    if (req.headers[CSRF_HEADER]) return next();
    res.status(403).json({ error: { statusCode: 403, code: 'CSRF', message: "So'rov rad etildi (xavfsizlik sarlavhasi yo'q). Sahifani yangilab qayta urinib ko'ring" } });
  };
}