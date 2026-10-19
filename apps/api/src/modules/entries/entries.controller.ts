import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { EntriesService } from './entries.service';

/** Tez kiritish: bugun kiritilgan yozuvlar va «Boshlash» ro'yxati (faqat administrator) */
@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  /** ?date=YYYY-MM-DD (bo'lmasa — bugun, Toshkent vaqti) */
  @Roles(UserRole.ADMIN)
  @Get('today')
  async today(@Query('date') date?: string) {
    return { data: await this.entries.today(date) };
  }

  /** «Boshlash» ro'yxati: nima to'ldirilgan, nima qolgan */
  @Roles(UserRole.ADMIN)
  @Get('setup')
  async setup() {
    return { data: await this.entries.setup() };
  }
}