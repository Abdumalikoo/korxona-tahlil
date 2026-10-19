import { CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// ═══════════════════════════════════════════════════════════
// So'rovlar tezligini cheklash (kirish sahifalari uchun) — tashqi paketsiz, xotirada.
// @RateLimit({ limit: 10, windowSec: 60 }) — bitta IP va bitta manzil uchun oynada ko'pi bilan `limit` ta so'rov.
// ID kod bilan kirishda qo'shimcha: bitta kodga ham alohida limit (IP almashtirib ham tanlab bo'lmasin).
// Bir nusxada ishlaydigan dastur uchun yetarli (loyiha bitta serverda).
// ═══════════════════════════════════════════════════════════

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  /** So'rov tanasidagi shu maydon bo'yicha ham alohida hisoblanadi (masalan, 'code' yoki 'username') */
  bodyKey?: string;
  /** Tanadagi kalit uchun limit (standart: limit * 2) */
  bodyLimit?: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

function hit(key: string, limit: number, windowMs: number, now: number): number {
  const fresh = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    buckets.set(key, fresh);
    return Math.max(1, Math.ceil((windowMs - (now - fresh[0]!)) / 1000));
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return 0;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;
    const req = context.switchToHttp().getRequest<{ ip?: string; body?: Record<string, unknown>; route?: { path?: string } }>();
    const now = Date.now();
    const windowMs = options.windowSec * 1000;
    if (now - lastSweep > 5 * 60_000) {
      lastSweep = now;
      for (const [k, v] of buckets) if (v.every((t) => now - t >= 3600_000)) buckets.delete(k);
    }
    const route = req.route?.path ?? 'x';
    let wait = hit(`ip:${route}:${req.ip ?? '?'}`, options.limit, windowMs, now);
    if (!wait && options.bodyKey) {
      const raw = req.body?.[options.bodyKey];
      if (typeof raw === 'string' && raw.trim()) wait = hit(`k:${route}:${raw.trim().toLowerCase().slice(0, 64)}`, options.bodyLimit ?? options.limit * 2, windowMs, now);
    }
    if (wait) {
      throw new HttpException({ message: `Juda ko'p urinish. ${wait} soniyadan keyin qayta urinib ko'ring`, error: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

/** Faqat testlar uchun */
export function resetRateLimits(): void {
  buckets.clear();
}