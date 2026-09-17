import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { RegionalIncomeService } from './regional-income.service';
import { Roles, CurrentUser } from '../../common/decorators';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Controller('incomes/regional')
export class RegionalIncomeController {
  constructor(private readonly regional: RegionalIncomeService) {}

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
  }

  /** Bosh shablon - har hudud alohida varaq */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    this.assertPeriod(period);

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

  /** Faylni tahlil qilish - hali saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(
    @Query('period') period: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertPeriod(period);
    const data = await this.regional.analyze(period, file);
    return { data };
  }

  /** Tahlil natijasini saqlash */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  async commit(
    @Query('period') period: string,
    @Query('replace') replace: string,
    @Body() body: { rows: unknown[] },
    @CurrentUser('id') userId: string,
  ) {
    this.assertPeriod(period);

    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    // Summalar JSON orqali matn sifatida keladi
    const rows = body.rows.map((raw) => {
      const row = raw as {
        regionCode: number;
        regionName: string;
        categoryCode: string;
        categoryLabel: string;
        quantity: number | null;
        amountTiyin: string | number;
      };

      return {
        regionCode: Number(row.regionCode),
        regionName: String(row.regionName),
        categoryCode: String(row.categoryCode),
        categoryLabel: String(row.categoryLabel),
        quantity: row.quantity === null ? null : Number(row.quantity),
        amountTiyin: BigInt(row.amountTiyin),
      };
    });

    const data = await this.regional.commit(
      period,
      rows,
      userId,
      replace === 'true',
    );
    return { data };
  }

  /** Hududlar kesimi */
  @Get('summary/region')
  async summaryByRegion(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.regional.summaryByRegion(period);
    return { data };
  }

  /** Xizmat turlari kesimi */
  @Get('summary/service')
  async summaryByService(
    @Query('period') period: string,
    @Query('regionCode') regionCode?: string,
  ) {
    this.assertPeriod(period);

    const code =
      regionCode === undefined || regionCode === '' ? undefined : Number(regionCode);

    const data = await this.regional.summaryByService(period, code);
    return { data };
  }
}
