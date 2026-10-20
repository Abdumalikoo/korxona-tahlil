import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/security/rate-limit';
import { WarehouseSigns } from './warehouse.sign';
import type { DocInput } from './warehouse.types';

/** Dalolatnomani rasmiylashtirish (QR) va imzolanganlar arxivi — dastur ichida */
@Controller('warehouse')
export class WarehouseSignController {
  constructor(private readonly signs: WarehouseSigns) {}

  /** Imzolangan va kutilayotgan dalolatnomalar (?status=PENDING|SIGNED) */
  @Get('signs')
  async list(@Query('status') status?: string) {
    return { data: await this.signs.list(status) };
  }

  // ── Saqlashdan oldin: «Tasdiqlash» → QR → xodim imzolaydi → «Saqlash» ──

  /** Hujjat tekshiriladi va dalolatnoma tayyorlanadi (bazaga yozilmaydi), QR havola beriladi */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('sign-drafts')
  @HttpCode(HttpStatus.OK)
  async createDraft(@Body() body: { input?: DocInput; origin?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.signs.createDraft(body?.input ?? {}, body?.origin, userId) };
  }

  @Get('sign-drafts/:id')
  async draft(@Param('id') id: string) {
    return { data: await this.signs.draftStatus(id) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('sign-drafts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelDraft(@Param('id') id: string) {
    return { data: await this.signs.cancelDraft(id) };
  }

  /** Imzolangandan keyin «Saqlash»: hujjat bazaga, imzoli nusxa arxivga va Telegram'ga */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('sign-drafts/:id/commit')
  @HttpCode(HttpStatus.OK)
  async commitDraft(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.signs.commitDraft(id, userId) };
  }

  // ── Saqlangan hujjatni keyin imzolatish ──

  @Get('docs/:id/sign')
  async status(@Param('id') id: string) {
    return { data: await this.signs.status(id) };
  }

  /** «Rasmiylashtirish»: QR havola (origin — brauzer manzili; localhost bo'lsa kompyuterning tarmoq manzili olinadi) */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('docs/:id/sign')
  @HttpCode(HttpStatus.OK)
  async start(@Param('id') id: string, @Body() body: { origin?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.signs.start(id, body?.origin, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('docs/:id/sign/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string) {
    return { data: await this.signs.cancel(id) };
  }

  /** Telegram'ga qayta yuborish */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('docs/:id/sign/resend')
  @HttpCode(HttpStatus.OK)
  async resend(@Param('id') id: string) {
    return { data: await this.signs.resend(id) };
  }

  /** Imzolangan nusxa (Word) */
  @Get('docs/:id/sign/archive')
  async archive(@Param('id') id: string, @Res() response: Response) {
    const file = await this.signs.archiveFile(id);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(file.buffer);
  }
}

/** Telefon: QR havola orqali — kirishsiz (maxfiy kalit bilan) */
@Public()
@Controller('public/acts')
export class PublicActsController {
  constructor(private readonly signs: WarehouseSigns) {}

  // Telefonlar Next vositachisi orqali bitta (lokal) IP dan keladi — chegara kengroq;
  // tanlab topishdan himoya — har havolada 5 urinish va 15 daqiqa qulf (servisda)
  @RateLimit({ limit: 120, windowSec: 60 })
  @Get(':token')
  async view(@Param('token') token: string) {
    return { data: await this.signs.publicView(token) };
  }

  @RateLimit({ limit: 30, windowSec: 60 })
  @Post(':token/sign')
  @HttpCode(HttpStatus.OK)
  async sign(
    @Param('token') token: string,
    @Body() body: { pinfl4?: unknown; signature?: unknown; photo?: unknown; method?: unknown; agree?: unknown },
    @Ip() ip: string,
    @Headers('user-agent') agent?: string,
    @Headers('x-forwarded-for') forwarded?: string,
  ) {
    return { data: await this.signs.sign(token, body ?? {}, { ip: clientIp(ip, forwarded), agent }) };
  }
}

/** Telefon so'rovi Next vositachisi (shu kompyuter) orqali keladi — haqiqiy IP x-forwarded-for da */
export function clientIp(ip: string | undefined, forwarded: string | undefined): string | undefined {
  const local = !ip || /^(::1|127\.|::ffff:127\.)/.test(ip);
  const first = forwarded?.split(',')[0]?.trim();
  return local && first ? first.replace(/^::ffff:/, '').slice(0, 64) : ip;
}