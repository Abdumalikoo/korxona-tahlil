import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../../modules/auth/auth.types';

/**
 * Kontroller metodida joriy foydalanuvchini oladi:
 *   findAll(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
