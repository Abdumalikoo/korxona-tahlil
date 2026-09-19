import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Res,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { SimpleImportService, type SimpleRow } from './simple-import.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Controller('simple-import')
export class SimpleImportController {
  constructor(private readonly service: SimpleImportService) {}

  private assertKind(kind: string): 'expense' | 'income' {
    if (kind !== 'expense' && kind !== 'income') {
      throw new BadRequestException('Notogri tur');
    }
    return kind;
  }

  /** Bosh shablon */
  @Get('template/:kind')
  async template(@Param('kind') kind: string, @Res() response: Response) {
    const type = this.assertKind(kind);
    const { buffer, filename } = this.service.buildTemplate(type);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(await buffer);
  }

  /** Faylni tahlil qilish */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File) {
    const data = await this.service.analyze(file);
    return { data };
  }

  /** Saqlash */
  @Roles(UserRole.ADMIN)
  @Post('commit/:kind')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Param('kind') kind: string,
    @Body() body: { rows: { rowIndex: number; name: string; amountTiyin: string }[] },
    @CurrentUser('id') userId: string,
  ) {
    const type = this.assertKind(kind);

    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const rows: SimpleRow[] = body.rows.map((row) => ({
      rowIndex: Number(row.rowIndex),
      name: String(row.name),
      amountTiyin: BigInt(row.amountTiyin),
    }));

    const data = await this.service.commit(type, rows, userId);
    return { data };
  }
}
