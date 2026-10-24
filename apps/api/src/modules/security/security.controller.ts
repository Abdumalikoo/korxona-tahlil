import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
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

  /** Ma'lumotnomalardagi shaxsiy maydonlar: nechtasi shifrlangan */
  @Get('hr-crypto')
  async hrCrypto() {
    return { data: await this.security.hrCrypto() };
  }

  /** Hozir shifrlash (oldin zaxira olinadi) */
  @Post('hr-crypto/seal')
  @HttpCode(HttpStatus.OK)
  async sealHr(@CurrentUser('id') userId: string) {
    return { data: await this.security.sealHr(userId) };
  }

  /** Shifrdan chiqarish (orqaga qaytarish) — o'chirish paroli bilan */
  @Post('hr-crypto/unseal')
  @HttpCode(HttpStatus.OK)
  async unsealHr(@Body() body: { password?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.security.unsealHr(body?.password, userId) };
  }

  /** Kuzatuvchiga shaxsiy ma'lumotlarni ochish / yopish */
  @Patch('viewer-personal')
  async viewerPersonal(@Body() body: { enabled?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.security.setViewerPersonal(body?.enabled, userId) };
  }
}