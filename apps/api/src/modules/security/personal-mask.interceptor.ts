import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { from, type Observable, switchMap, of } from 'rxjs';
import { PERSONAL_KEY, type PersonalMode } from '../../common/decorators/personal.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SecurityService } from './security.service';

/** Kuzatuvchiga beriladigan javobdan olib tashlanadigan maydonlar */
const DROP = new Set(['passport', 'passportSeries', 'passportNumber', 'phone', 'phones', 'address', 'birthDate', 'birthday']);
const PINFL_KEYS = new Set(['pinfl', 'jshshir']);

/** JShShIR: oxirgi 4 raqami qoladi (qatorlarni farqlash uchun) */
export function maskPinfl(v: unknown): unknown {
  if (typeof v !== 'string' && typeof v !== 'number') return v;
  const s = String(v);
  return s.length <= 4 ? '••••' : `••••••••••${s.slice(-4)}`;
}

export function maskPersonal(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((v) => maskPersonal(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    out[k] = PINFL_KEYS.has(k) ? maskPinfl(v) : maskPersonal(v, depth + 1);
  }
  return out;
}

/** @Personal('mask') marshrutlarda Kuzatuvchi javobini yashirish */
@Injectable()
export class PersonalMaskInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: SecurityService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const mode = this.reflector.getAllAndOverride<PersonalMode | undefined>(PERSONAL_KEY, [context.getHandler(), context.getClass()]);
    if (mode !== 'mask') return next.handle();
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.role !== UserRole.VIEWER) return next.handle();
    return from(this.security.viewerPersonal()).pipe(switchMap((open) => (open ? next.handle() : next.handle().pipe(switchMap((body) => of(maskPersonal(body)))))));
  }
}