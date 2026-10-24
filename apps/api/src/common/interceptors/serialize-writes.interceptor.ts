import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { runExclusive } from '../locks';

// ═══════════════════════════════════════════════════════════
// Yozuvchi so'rovlar (POST / PUT / PATCH / DELETE) bo'lim bo'yicha navbat bilan bajariladi.
//
// Sabab: bo'limlar ko'p ma'lumotni bitta JSON sozlamada saqlaydi («o'qib → o'zgartirib → yozish»).
// Ikki so'rov bir vaqtda kelsa, birining o'zgarishi yo'qolardi. Endi bir bo'lim ichidagi
// yozuvlar ketma-ket bajariladi; boshqa bo'limlar va barcha o'qish (GET) so'rovlari kutmaydi.
// Kirish (auth) navbatga qo'yilmaydi.
// ═══════════════════════════════════════════════════════════

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIP = new Set(['auth']);
/** Katta import ham sig'sin: navbatda kutish chegarasi */
const WAIT_MS = 120_000;

export function sectionOf(raw: unknown): string {
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
    .replace(/^\/+|\/+$/g, '')
    .split('/')[0] ?? '';
}

@Injectable()
export class SerializeWritesInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const method = String(context.switchToHttp().getRequest<{ method?: string }>().method ?? '').toUpperCase();
    if (!WRITE.has(method)) return next.handle();
    const section = sectionOf(this.reflector.get<string | string[] | undefined>(PATH_METADATA, context.getClass()));
    if (!section || SKIP.has(section)) return next.handle();
    return from(runExclusive(`write:${section}`, () => lastValueFrom(next.handle(), { defaultValue: undefined }), WAIT_MS));
  }
}