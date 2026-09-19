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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
    // Xavfsizlik - faqat sql fayl va papkadan tashqariga chiqmasin
    if (!/^[\w.-]+\.sql$/.test(name)) {
      throw new NotFoundException('Fayl topilmadi');
    }

    const dir = process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
    const filePath = join(dir, name);

    if (!existsSync(filePath)) {
      throw new NotFoundException('Fayl topilmadi');
    }

    response.download(filePath, name);
  }
}
