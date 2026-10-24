import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
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
import { isSegment } from '../../common/segments/segments';
import { SalaryCompositionService } from './salary-composition.service';
import { SalaryStructureService } from './salary-composition.structure';
import type { CommitRow, ComponentInput } from './salary-composition.types';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CommitBody {
  fileName?: string;
  rows: {
    pinfl: string;
    fullName?: string | null;
    workedDays?: number | null;
    rate?: number | null;
    /** Komponent kodi → summa (tiyin, satr ko'rinishida) */
    items: Record<string, string>;
  }[];
}

@Controller('salary-composition')
export class SalaryCompositionController {
  constructor(
    private readonly composition: SalaryCompositionService,
    private readonly structure: SalaryStructureService,
  ) {}

  private sendFile(response: Response, buffer: Buffer, filename: string): void {
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  /** ?unit= — yo'nalish (TAX_FREE …): alohida tarkib. Bo'lmasa — umumiy (Markaz) tarkib */
  private unitOf(raw?: string): string | undefined {
    if (raw === undefined || raw === '') return undefined;
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  private optionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // ═══════════ Komponentlar ═══════════

  /** Komponentlar ro'yxati (faol va nofaol) */
  @Get('components')
  async components() {
    const data = await this.composition.listComponents();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post('components')
  async createComponent(@Body() body: ComponentInput) {
    const data = await this.composition.createComponent(body ?? {});
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch('components/:code')
  async updateComponent(@Param('code') code: string, @Body() body: ComponentInput) {
    const data = await this.composition.updateComponent(code, body ?? {});
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete('components/:code')
  async removeComponent(@Param('code') code: string) {
    const data = await this.composition.removeComponent(code);
    return { data };
  }

  // ═══════════ Shablon va yuklash ═══════════

  /** Shablon — faol komponentlar, formulalar va Xodimlar varag'i bilan */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response, @Query('unit') unit?: string) {
    const { buffer, filename } = await this.composition.buildTemplate(period, this.unitOf(unit));
    this.sendFile(response, buffer, filename);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Query('period') period: string, @UploadedFile() file: Express.Multer.File, @Query('sheet') sheet?: string, @Query('unit') unit?: string) {
    const data = await this.composition.analyze(period, file, sheet || undefined, this.unitOf(unit));
    return { data };
  }

  /** Saqlash — shu oyning oldingi tarkibini almashtiradi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Query('period') period: string,
    @Body() body: CommitBody,
    @CurrentUser('id') userId: string,
    @Query('unit') unitRaw?: string,
  ) {
    const unit = this.unitOf(unitRaw);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun ma\'lumot yo\'q');
    }

    const rows: CommitRow[] = body.rows.map((row) => {
      try {
        const items = new Map<string, bigint>();
        for (const [code, value] of Object.entries(row.items ?? {})) {
          items.set(String(code), BigInt(value));
        }
        return {
          pinfl: String(row.pinfl ?? ''),
          fullName: row.fullName ? String(row.fullName) : null,
          workedDays: this.optionalNumber(row.workedDays),
          rate: this.optionalNumber(row.rate),
          items,
        };
      } catch {
        throw new BadRequestException(`Noto'g'ri qator: ${row?.pinfl}`);
      }
    });

    const data = await this.composition.commit({
      period,
      rows,
      fileName: body.fileName ?? 'tarkib.xlsx',
      userId,
      unit,
    });
    return { data };
  }

  /** Yuklashni bekor qilish */
  @Roles(UserRole.ADMIN)
  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string, @Query('unit') unit?: string, @Query('period') period?: string) {
    const data = await this.composition.cancel(id, this.unitOf(unit), period);
    return { data };
  }

  /** Yuklashlar tarixi */
  @Get('batches')
  async batches(@Query('period') period?: string, @Query('unit') unit?: string) {
    const data = await this.composition.batches(period || undefined, this.unitOf(unit));
    return { data };
  }

  // ═══════════ Ko'rish ═══════════

  /** Oy tarkibi: xodimlar, komponentlar, guruhlar, tekshiruv */
  @Get('view')
  async view(@Query('period') period: string, @Query('unit') unit?: string) {
    const data = await this.composition.view(period, this.unitOf(unit));
    return { data };
  }

  /** Oy holati — soliq hisobotiga mosligi */
  @Get('check')
  async check(@Query('period') period: string, @Query('unit') unit?: string) {
    const data = await this.composition.check(period, this.unitOf(unit));
    return { data };
  }

  /** Ish haqi tuzilmasi — oylar, guruhlar, bo'limlar (from/to: "YYYY-MM") */
  @Get('structure')
  async salaryStructure(@Query('from') from: string, @Query('to') to: string) {
    const data = await this.structure.structure(from, to);
    return { data };
  }

  /** Bitta xodimning oylar bo'yicha tarkibi */
  @Get('employee/:pinfl')
  async employee(
    @Param('pinfl') pinfl: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unit') unit?: string,
  ) {
    const data = await this.composition.employeeHistory(pinfl, from || undefined, to || undefined, this.unitOf(unit));
    return { data };
  }

  /** Saqlangan tarkib Excel'da (Tarkib, Guruhlar, Farqlar) */
  @Get('export')
  async exportExcel(@Query('period') period: string, @Res() response: Response, @Query('unit') unit?: string) {
    const { buffer, filename } = await this.composition.exportExcel(period, this.unitOf(unit));
    this.sendFile(response, buffer, filename);
  }
}