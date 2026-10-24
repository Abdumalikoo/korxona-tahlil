import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PERSONAL_KEY, type PersonalMode } from '../../common/decorators/personal.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SecurityService } from './security.service';

/**
 * @Personal('deny') marshrutlar Kuzatuvchi (VIEWER) uchun yopiq —
 * administrator Sozlamalar › Xavfsizlik'da ochmagan bo'lsa.
 * JwtAuthGuard'dan keyin ishlaydi (app.module'da tartib bilan ro'yxatga olingan).
 */
@Injectable()
export class PersonalDataGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: SecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mode = this.reflector.getAllAndOverride<PersonalMode | undefined>(PERSONAL_KEY, [context.getHandler(), context.getClass()]);
    if (mode !== 'deny') return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user || user.role !== UserRole.VIEWER) return true;
    if (await this.security.viewerPersonal()) return true;
    throw new ForbiddenException({
      message: "Shaxsiy ma'lumotlar (xodimlar ro'yxati, JShShIR, shaxsiy ish haqi) kuzatuvchi uchun yopiq. Kerak bo'lsa, administrator Sozlamalar › Xavfsizlik'da ochadi",
      error: 'PERSONAL_FORBIDDEN',
    });
  }
}