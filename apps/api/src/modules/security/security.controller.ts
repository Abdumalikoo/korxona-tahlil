import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { SecurityService } from './security.service';

@Roles(UserRole.ADMIN)
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  /** Xavfsizlik holati: standart parol/kodlar, kuzatuvchi huquqi */
  @Get('status')
  async status() {
    return { data: await this.security.status() };
  }

  /** Kuzatuvchiga shaxsiy ma'lumotlarni ochish / yopish */
  @Patch('viewer-personal')
  async viewerPersonal(@Body() body: { enabled?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.security.setViewerPersonal(body?.enabled, userId) };
  }
}