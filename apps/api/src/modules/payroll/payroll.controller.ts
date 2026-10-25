import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { PayrollService, type MissingRow } from './payroll.service';
import { SourceArchiveService } from '../source-archive/source-archive.service';
import { assertAmount } from '../../common/validation/amount';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CommitBody {
  fileName?: string;
  rows: { pinfl: string; amountTiyin: string }[];
  missing?: MissingRow[];
}

@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly archive: SourceArchiveService,
  ) {}

  private sendFile(response: Response, buffer: Buffer, filename: string): void {
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.payroll.buildTemplate(period);
    this.sendFile(response, buffer, filename);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.payroll.analyze(period, file);
    // Manba fayl arxivga — saqlanganda shu yuklash bilan bog'lanadi
    await this.archive.hold('payroll', file, { userId, periods: [period] });
    return { data };
  }

  /** Saqlash — bitta tranzaksiyada */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Query('period') period: string,
    @Query('replace') replace: string,
    @Body() body: CommitBody,
    @CurrentUser('id') userId: string,
  ) {
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const rows = body.rows.map((row) => {
      try {
        return { pinfl: String(row.pinfl), amountTiyin: assertAmount(BigInt(row.amountTiyin), String(row.pinfl)) };
      } catch {
        throw new BadRequestException(`Notogri summa: ${row.pinfl}`);
      }
    });

    const data = await this.payroll.commit({
      period,
      rows,
      userId,
      replacePrevious: replace === 'true',
      fileName: body.fileName ?? 'ish-haqi.xlsx',
      missing: Array.isArray(body.missing) ? body.missing : [],
    });
    await this.archive.link('payroll', { userId, fileName: body.fileName ?? 'ish-haqi.xlsx', refId: data.batchId, periods: [period] });

    return { data };
  }

  /** Shu oy ish haqisini hudud tarixiga qarab qayta guruhlash */
  @Roles(UserRole.ADMIN)
  @Post('regroup')
  @HttpCode(HttpStatus.OK)
  async regroup(@Query('period') period: string) {
    const data = await this.payroll.regroup(period);
    return { data };
  }

  @Personal()
  @Post('missing/export')
  async exportMissing(
    @Body() body: { period: string; missing: MissingRow[] },
    @Res() response: Response,
  ) {
    const { buffer, filename } = await this.payroll.buildMissingExcel(
      body?.period ?? 'davr',
      Array.isArray(body?.missing) ? body.missing : [],
    );
    this.sendFile(response, buffer, filename);
  }

  @Roles(UserRole.ADMIN)
  @Post(':batchId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('batchId') batchId: string) {
    const data = await this.payroll.cancel(batchId);
    await this.archive.cancel('payroll', batchId);
    return { data };
  }

  @Personal()
  @Get('expense/:expenseId')
  async expenseDetail(@Param('expenseId') expenseId: string) {
    const data = await this.payroll.expenseDetail(expenseId);
    return { data };
  }

  @Get('batches')
  async batches(@Query('period') period?: string) {
    const data = await this.payroll.findBatches(period);
    return { data };
  }

  @Personal()
  @Get('batches/:batchId')
  async batch(@Param('batchId') batchId: string) {
    const data = await this.payroll.findBatch(batchId);
    return { data };
  }
}