import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { RolesService } from './roles.service';

/**
 * Rollar — umumiy hudud uchun (administrator, kuzatuvchi). Ishchi rollarga yopiq (AccessGuard).
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Rollar: nomi (administrator qo'ygani), xodimlar soni, dashbordlar */
  @Get()
  async list() {
    return { data: await this.roles.list() };
  }

  /** Rol dashbordi uchun: xodimlar, bugungi va haftalik ish, oxirgi harakatlar */
  @Get(':role/overview')
  async overview(@Param('role') role: string) {
    return { data: await this.roles.overview(role) };
  }

  /** Rol nomini o'zgartirish ({ label }; bo'sh — asl nomiga qaytadi) */
  @Roles(UserRole.ADMIN)
  @Patch(':role')
  async rename(@Param('role') role: string, @Body() body: { label?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.roles.rename(role, body?.label, userId) };
  }
}