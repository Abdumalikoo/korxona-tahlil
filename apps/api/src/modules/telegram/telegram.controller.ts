import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { TelegramService } from './telegram.service';

/** Telegram bot sozlamasi va xodimlarni botga bog'lash */
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('status')
  async status() {
    return { data: await this.telegram.status() };
  }

  @Roles(UserRole.ADMIN)
  @Post('token')
  async setToken(@Body() body: { token?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.telegram.setToken(body?.token, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('token')
  async clearToken(@CurrentUser('id') userId: string) {
    return { data: await this.telegram.clearToken(userId) };
  }

  @Get('links')
  async links() {
    return { data: await this.telegram.links() };
  }

  /** Xodim uchun shaxsiy havola (7 kun) */
  @Roles(UserRole.ADMIN)
  @Post('links/:pinfl')
  async createLink(@Param('pinfl') pinfl: string) {
    return { data: await this.telegram.createLink(pinfl) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('links/:pinfl')
  async unlink(@Param('pinfl') pinfl: string, @CurrentUser('id') userId: string) {
    return { data: await this.telegram.unlink(pinfl, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('test/:pinfl')
  async test(@Param('pinfl') pinfl: string) {
    return { data: await this.telegram.test(pinfl) };
  }
}