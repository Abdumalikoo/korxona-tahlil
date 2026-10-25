import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRequire } from 'node:module';

// express — API'ning o'z bog'liqligi emas (pnpm'da faqat @nestjs/platform-express ichida bor), shuning uchun
// o'sha paket joylashgan joydan topiladi: har qanday o'rnatish tuzilmasida ishlaydi.
const fromNest = createRequire(require.resolve('@nestjs/platform-express'));
const { json, urlencoded } = fromNest('express') as typeof import('express');

// ═══════════════════════════════════════════════════════════
// So'rov tanasi (JSON / forma) hajmi chegarasi — manzil bo'yicha.
//  • Kirish (login, ID kod): 16 KB — parol va kod uchun yetarli;
//  • Telefondan imzo (public/acts): 2 MB — imzo rasmi va yuz surati (servisda ham alohida chegara bor);
//  • Qolgan hamma manzil (faqat kirgan foydalanuvchi): BODY_LIMIT (standart 10 MB).
// Chegaradan oshsa — 413 (tana o'qilmaydi, server band bo'lmaydi). Fayl yuklash (multipart) bunga kirmaydi —
// u har manzilda alohida (FileInterceptor limits).
// ═══════════════════════════════════════════════════════════

const RULES: { re: RegExp; limit: string }[] = [
  { re: /^\/api\/auth\/(login|code-login)\/?$/, limit: '16kb' },
  { re: /^\/api\/public\//, limit: '2mb' },
];

export function limitFor(path: string, fallback: string): string {
  return RULES.find((r) => r.re.test(path))?.limit ?? fallback;
}

export function bodyLimits(fallback: string): RequestHandler {
  const cache = new Map<string, RequestHandler[]>();
  const parsers = (limit: string) => {
    let p = cache.get(limit);
    if (!p) {
      p = [json({ limit }), urlencoded({ limit, extended: true })];
      cache.set(limit, p);
    }
    return p;
  };
  // Katta yoki buzilgan tana — aniq javob (logga «ichki xato» bo'lib tushmasin)
  const fail = (res: Response, next: NextFunction, err: unknown) => {
    const e = err as { type?: string; status?: number; limit?: number };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: "So'rov hajmi juda katta" } });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { statusCode: 400, code: 'BAD_JSON', message: "So'rov tanasi noto'g'ri (JSON)" } });
      return;
    }
    next(err);
  };
  return (req: Request, res: Response, next: NextFunction) => {
    const [j, u] = parsers(limitFor(req.path, fallback));
    j!(req, res, (err?: unknown) => (err ? fail(res, next, err) : u!(req, res, (err2?: unknown) => (err2 ? fail(res, next, err2) : next()))));
  };
}