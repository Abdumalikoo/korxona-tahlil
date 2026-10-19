import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../../modules/auth/auth.types';
import { roleAccess } from '../access/role-access';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Ishchi rollar (Omborchi va h.k.) uchun bo'lim chegarasi.
 *
 * JwtAuthGuard'dan keyin ishlaydi. Admin va kuzatuvchiga ta'sir qilmaydi.
 * Ishchi rol faqat role-access.ts da yozilgan kontrollerlarga murojaat qila oladi;
 * qolgan hamma so'rov — 403. Menyuni yashirish yetarli emas: cheklov shu yerda.
 *
 * PIN admin tomonidan berilgan/tiklangan bo'lsa — avval o'z PIN'ini o'zgartirmaguncha
 * faqat «auth» bo'limi ochiq.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) return true; // autentifikatsiyani JwtAuthGuard tekshiradi

    const access = roleAccess(user.role);
    if (!access) return true; // admin / kuzatuvchi — cheklanmagan

    const raw = this.reflector.get<string | string[] | undefined>(PATH_METADATA, context.getClass());
    const section = String(Array.isArray(raw) ? raw[0] : (raw ?? '')).replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';

    if (user.mustChangePin && section !== 'auth') {
      throw new ForbiddenException({ message: "Avval o'z PIN kodingizni o'rnating", error: 'PIN_CHANGE_REQUIRED' });
    }
    if (!access.api.includes(section)) {
      throw new ForbiddenException({ message: `Bu bo'lim «${access.label}» roli uchun ochiq emas`, error: 'ROLE_FORBIDDEN' });
    }
    return true;
  }
}