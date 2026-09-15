import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Marshrutga faqat ko'rsatilgan rollar kira oladi */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
