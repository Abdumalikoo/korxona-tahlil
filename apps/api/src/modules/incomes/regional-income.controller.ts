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
import { assertAmount } from '../../common/validation/amount';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface CommitBody {
  rows: {
    regionCode: number;
    regionName: string;
    districtId?: string | null;
    districtName?: string | null;
    categoryCode: string;
    categoryLabel: string;
    quantity: number | null;
    amountTiyin: string;
  }[];
}

@Controller('incomes/regional')
export class RegionalIncomeController {
  constructor(private readonly regional: RegionalIncomeService) {}

  /** Tuman kesimidagi shablon — har bir viloyat alohida varaqda, tumanlar ustunlarda */
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
          districtId: row.districtId ? String(row.districtId) : null,
          districtName: row.districtName ? String(row.districtName) : null,
          categoryCode: String(row.categoryCode),
          categoryLabel: String(row.categoryLabel),
          quantity:
            row.quantity === null || row.quantity === undefined ? null : Number(row.quantity),
          amountTiyin: assertAmount(BigInt(row.amountTiyin), `${row.regionName} - ${row.categoryLabel}`),
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

  /** Bitta viloyat tumanlari bo'yicha (tumansiz yozuvlar — alohida qator) */
  @Get('summary/district')
  async summaryByDistrict(
    @Query('period') period: string,
    @Query('regionCode') regionCode: string,
  ) {
    const data = await this.regional.summaryByDistrict(period, Number(regionCode));
    return { data };
  }

  /** Xizmat turlari bo'yicha; districtId="-" — tumanga bo'linmagan yozuvlar */
  @Get('summary/service')
  async summaryByService(
    @Query('period') period: string,
    @Query('regionCode') regionCode?: string,
    @Query('districtId') districtId?: string,
  ) {
    const code = regionCode === undefined || regionCode === '' ? undefined : Number(regionCode);
    const district = districtId === undefined || districtId === '' ? undefined : districtId;
    const data = await this.regional.summaryByService(period, code, district);
    return { data };
  }
}