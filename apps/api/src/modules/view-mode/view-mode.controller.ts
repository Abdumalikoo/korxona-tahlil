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
}