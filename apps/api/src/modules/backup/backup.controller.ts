import {
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    Post,
    Res,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../../common/decorators';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Zaxiralar royxati va umumiy malumot */
  @Roles(UserRole.ADMIN)
  @Get()
  async list() {
    const [files, stats] = await Promise.all([
      this.backup.list(),
      this.backup.stats(),
    ]);

    return { data: { files, stats } };
  }

  /** Yangi zaxira olish */
  @Roles(UserRole.ADMIN)
  @Post('create')
  @HttpCode(HttpStatus.OK)
  async create() {
    const data = await this.backup.create();
    return { data };
  }

  /** Eski zaxiralarni tozalash */
  @Roles(UserRole.ADMIN)
  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanup() {
    const data = await this.backup.cleanup();
    return { data };
  }

  /** Zaxira faylni yuklab olish */
  @Roles(UserRole.ADMIN)
  @Get('download/:name')
  async download(@Param('name') name: string, @Res() response: Response) {
    // Xavfsizlik — faqat zaxira fayli nomi va zaxiralar papkasi ichidan
    const filePath = this.backup.resolve(name);
    if (!filePath) {
      throw new NotFoundException('Fayl topilmadi');
    }

    response.download(filePath, name);
  }
}