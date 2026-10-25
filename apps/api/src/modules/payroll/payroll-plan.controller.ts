import { Body, Controller, HttpCode, HttpStatus, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { PayrollPlanService } from './payroll-plan.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Umumiy vedomost — bo'limlar bilan birga (tahlil, reja, saqlash). Faqat administrator */
@Roles(UserRole.ADMIN)
@Controller('payroll-plan')
export class PayrollPlanController {
  constructor(private readonly plans: PayrollPlanService) {}

  /** Fayl: har xodim qayerga yoziladi (hech narsa saqlanmaydi) */
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Query('period') period: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.plans.analyze(period, file) };
  }

  /** O'zgartirilgan taqsimot bo'yicha qayta hisoblash (hech narsa saqlanmaydi) */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Query('period') period: string, @Body() body: { rows?: unknown }) {
    return { data: await this.plans.plan(period, (body?.rows ?? []) as never[]) };
  }

  /** Saqlash: umumiy qism va bo'limlar */
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Query('period') period: string, @Query('replace') replace: string, @Body() body: { rows?: unknown; fileName?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.plans.commit(period, body, replace === 'true', userId) };
  }
}