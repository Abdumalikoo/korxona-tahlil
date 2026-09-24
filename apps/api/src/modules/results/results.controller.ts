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
import { CurrentUser, Roles } from '../../common/decorators';
import { ResultsService, type EmploymentKind, type ResultRow } from './results.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CommitBody {
  fileName?: string;
  rows: {
    pinfl: string;
    regionCode: number;
    districtId: string | null;
    employmentType: EmploymentKind;
    planTiyin: string;
    factTiyin: string;
    bonusTiyin: string;
  }[];
}

@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  private sendFile(response: Response, buffer: Buffer, filename: string): void {
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  private parseRegion(value?: string): number | undefined {
    return value === undefined || value === '' ? undefined : Number(value);
  }

  /** Shablon — formulalar va kodlar varag'i bilan */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.results.buildTemplate(period);
    this.sendFile(response, buffer, filename);
  }

  /** Oy natijalari Excel'da — hudud filtri bilan */
  @Get('export')
  async exportExcel(
    @Query('period') period: string,
    @Query('regionCode') regionCode: string | undefined,
    @Res() response: Response,
  ) {
    const { buffer, filename } = await this.results.exportExcel(
      period,
      this.parseRegion(regionCode),
    );
    this.sendFile(response, buffer, filename);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.results.analyze(period, file);
    return { data };
  }

  /** Saqlash — shu oyning oldingi yuklashini almashtiradi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Query('period') period: string,
    @Body() body: CommitBody,
    @CurrentUser('id') userId: string,
  ) {
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const rows: ResultRow[] = body.rows.map((row) => {
      try {
        return {
          pinfl: String(row.pinfl),
          regionCode: Number(row.regionCode),
          districtId: row.districtId ? String(row.districtId) : null,
          employmentType: row.employmentType,
          planTiyin: BigInt(row.planTiyin),
          factTiyin: BigInt(row.factTiyin),
          bonusTiyin: BigInt(row.bonusTiyin),
        };
      } catch {
        throw new BadRequestException(`Notogri qator: ${row.pinfl}`);
      }
    });

    const data = await this.results.commit({
      period,
      rows,
      fileName: body.fileName ?? 'natijalar.xlsx',
      userId,
    });

    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post(':batchId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('batchId') batchId: string) {
    const data = await this.results.cancel(batchId);
    return { data };
  }

  @Get('batches')
  async batches(@Query('period') period?: string) {
    const data = await this.results.findBatches(period);
    return { data };
  }

  /** Oy natijalari */
  @Get()
  async list(@Query('period') period: string, @Query('regionCode') regionCode?: string) {
    const data = await this.results.findResults(period, this.parseRegion(regionCode));
    return { data };
  }
}
