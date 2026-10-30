import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { ViewModeService } from './view-mode.service';

/** Ko'rinish rejimi: qisqa (rahbar) yoki to'liq */
@Controller('view-mode')
export class ViewModeController {
  constructor(private readonly viewMode: ViewModeService) {}

  /** Joriy rejim (hamma foydalanuvchi o'qiydi) */
  @Get()
  async get() {
    return { data: await this.viewMode.get() };
  }

  /** Rejimni almashtirish — faqat administrator (butun dastur uchun) */
  @Patch()
  @Roles(UserRole.ADMIN)
  async set(@Body() body: { mode?: unknown }) {
    return { data: await this.viewMode.set(body?.mode) };
  }

  /** «Faqat Bosh sahifa»: { on: true | false } — boshqa bo'limlar hamma uchun yashiriladi (faqat administrator) */
  @Patch('home-only')
  @Roles(UserRole.ADMIN)
  async homeOnly(@Body() body: { on?: unknown }) {
    return { data: await this.viewMode.setHomeOnly(body?.on) };
  }
}