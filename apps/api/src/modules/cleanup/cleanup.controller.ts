import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CleanupService } from './cleanup.service';
import { Roles } from '../../common/decorators';

@Controller('trash')
export class CleanupController {
  constructor(private readonly cleanup: CleanupService) {}

  /** Savatdagi yozuvlar soni */
  @Roles(UserRole.ADMIN)
  @Get('stats')
  async stats() {
    const data = await this.cleanup.trashStats();
    return { data };
  }

  /** Muddati otganlarni tozalash */
  @Roles(UserRole.ADMIN)
  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupExpired() {
    const data = await this.cleanup.cleanupNow();
    return { data };
  }

  /** Savatni butunlay bosatish - muddatdan qatiy nazar */
  @Roles(UserRole.ADMIN)
  @Post('empty')
  @HttpCode(HttpStatus.OK)
  async emptyTrash() {
    const data = await this.cleanup.emptyTrash();
    return { data };
  }
}
