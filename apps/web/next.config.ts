import type { NextConfig } from 'next';

// ═══════════════════════════════════════════════════════════
// Xavfsizlik sarlavhalari (har bir sahifaga):
//  • Content-Security-Policy — sahifa faqat o'z serveri va API'dan skript/ma'lumot oladi;
//    begona saytdan skript yuklab bo'lmaydi, tizimni boshqa sayt ichiga (iframe) joylab bo'lmaydi.
//  • nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy (kamera — faqat o'zi, imzo sahifasi uchun).
// API manzili NEXT_PUBLIC_API_URL dan olinadi (o'zgarsa — web qayta build qilinadi).
// ═══════════════════════════════════════════════════════════

const isDev = process.env.NODE_ENV !== 'production';

function apiOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').origin;
  } catch {
    return null;
  }
}

const api = apiOrigin();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${api ? ` ${api}` : ''}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  // API: aniq manzil + mahalliy tarmoqdagi boshqa kompyuterlardan kirish (3001-port)
  `connect-src 'self'${api ? ` ${api}` : ''} http://*:3001 https://*:3001${isDev ? ' ws: wss:' : ''}`,
  // PDF/rasmni yangi oynada ochish (blob) ishlashi uchun
  "object-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@korxona/shared'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;