import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { RegionalIncomeService, type ParsedRow } from './regional-income.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface CommitBody {
  rows: {
    regionCode: number;
    regionName: string;
    categoryCode: string;
    categoryLabel: string;
    quantity: number | null;
    amountTiyin: string;
  }[];
}

@Controller('incomes/regional')
export class RegionalIncomeController {
  constructor(private readonly regional: RegionalIncomeService) {}

  /** Bitta varaqli shablon — hududlar ustunlarda */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.regional.buildTemplate(period);

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

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = await this.regional.analyze(period, file);
    return { data };
  }

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

    const rows: ParsedRow[] = body.rows.map((row) => {
      try {
        return {
          regionCode: Number(row.regionCode),
          regionName: String(row.regionName),
          categoryCode: String(row.categoryCode),
          categoryLabel: String(row.categoryLabel),
          quantity:
            row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
          amountTiyin: BigInt(row.amountTiyin),
        };
      } catch {
        throw new BadRequestException(`Notogri qator: ${row.regionName} - ${row.categoryLabel}`);
      }
    });

    const data = await this.regional.commit(period, rows, userId, replace === 'true');
    return { data };
  }

  @Get('summary/region')
  async summaryByRegion(@Query('period') period: string) {
    const data = await this.regional.summaryByRegion(period);
    return { data };
  }

  @Get('summary/service')
  async summaryByService(
    @Query('period') period: string,
    @Query('regionCode') regionCode?: string,
  ) {
    const code = regionCode === undefined || regionCode === '' ? undefined : Number(regionCode);
    const data = await this.regional.summaryByService(period, code);
    return { data };
  }
}
