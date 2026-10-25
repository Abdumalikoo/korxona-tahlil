import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { SourceArchiveService, isSourceKind } from './source-archive.service';

/** Yuklangan manba fayllar arxivi (faqat administrator — fayllarda shaxsiy ma'lumot bor) */
@Controller('source-archive')
@Roles(UserRole.ADMIN)
export class SourceArchiveController {
  constructor(
    private readonly archive: SourceArchiveService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('kind') kind?: string, @Query('period') period?: string) {
    if (kind && !isSourceKind(kind)) throw new BadRequestException("Fayl turi noto'g'ri");
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("Oy noto'g'ri");
    return { data: await this.archive.list(kind && isSourceKind(kind) ? kind : undefined, period || undefined) };
  }

  /** Bog'liqliklarni qayta qo'llash: ?kind= (bo'lmasa — hammasi), ?force=true — qo'llanganlarini ham */
  @Post('relink')
  @HttpCode(HttpStatus.OK)
  async relink(@Query('kind') kind: string | undefined, @Query('force') force: string | undefined, @CurrentUser('id') userId: string) {
    if (kind && !isSourceKind(kind)) throw new BadRequestException("Fayl turi noto'g'ri");
    const r = await this.archive.backfill(kind && isSourceKind(kind) ? kind : undefined, force === 'true');
    await this.audit.log({ userId, action: 'UPDATE', entity: 'source_archive', entityId: kind || 'all', summary: `Arxiv: bog'liqliklar qayta qo'llandi — ${r.files} fayl${r.failed ? `, ${r.failed} xato` : ''}` });
    return { data: r };
  }

  @Post(':kind/:id/relink')
  @HttpCode(HttpStatus.OK)
  async relinkOne(@Param('kind') kind: string, @Param('id') id: string) {
    if (!isSourceKind(kind)) throw new BadRequestException("Fayl turi noto'g'ri");
    return { data: await this.archive.runLinkers(await this.archive.get(kind, id), true) };
  }

  @Get(':kind/:id/download')
  async download(@Param('kind') kind: string, @Param('id') id: string, @CurrentUser('id') userId: string, @Res() response: Response) {
    if (!isSourceKind(kind)) throw new BadRequestException("Fayl turi noto'g'ri");
    const e = await this.archive.get(kind, id);
    const buf = await this.archive.read(e);
    await this.audit.log({ userId, action: 'EXPORT', entity: 'source_archive', entityId: e.id, summary: `Arxivdan yuklab olindi: ${e.fileName}` });
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(e.fileName)}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(buf);
  }
}
