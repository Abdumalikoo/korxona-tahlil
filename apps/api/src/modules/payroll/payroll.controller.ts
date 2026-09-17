import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { PayrollService } from './payroll.service';
import { Roles, CurrentUser } from '../../common/decorators';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** Bosh shablon yuklab olish */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }

    const { buffer, filename } = await this.payroll.buildTemplate(period);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  /** Faylni yuklash va tahlil qilish - hali saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async analyze(
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }

    const data = await this.payroll.analyze(period, file, userId);
    return { data };
  }

  /** Qoralamani tasdiqlash - xarajatlar yaratiladi */
  @Roles(UserRole.ADMIN)
  @Post(':batchId/commit')
  async commit(
    @Param('batchId') batchId: string,
    @CurrentUser('id') userId: string,
    @Query('replace') replace?: string,
  ) {
    const data = await this.payroll.commit(batchId, userId, replace === 'true');
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post(':batchId/cancel')
  async cancel(@Param('batchId') batchId: string) {
    const data = await this.payroll.cancel(batchId);
    return { data };
  }

  /** Xarajat ortidagi xodimlar royxati */
  @Get('expense/:expenseId')
  async expenseDetail(@Param('expenseId') expenseId: string) {
    const data = await this.payroll.expenseDetail(expenseId);
    return { data };
  }

  /** Topilmagan PINFL larni Excel faylga chiqarish */
  @Get(':batchId/missing')
  async exportMissing(
    @Param('batchId') batchId: string,
    @Res() response: Response,
  ) {
    const { buffer, filename } = await this.payroll.exportMissing(batchId);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  @Get('batches')
  async batches(@Query('period') period?: string) {
    const data = await this.payroll.findBatches(period);
    return { data };
  }

  @Get('batches/:batchId')
  async batch(@Param('batchId') batchId: string) {
    const data = await this.payroll.findBatch(batchId);
    return { data };
  }
}
