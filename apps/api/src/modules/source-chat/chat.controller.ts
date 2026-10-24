import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { ChatPinService } from './chat-pin.service';
import { SourceChatService } from './chat.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Chat › Manba chati: /api/source-chat/… — tizimdagi manbalardan javob (faqat administrator).
 * Suhbatlar (threads), tozalash, saqlanganlar, Excel'ga yuklab olish — har foydalanuvchiniki alohida.
 * Chat kodi: kirish — «X-Chat-Token» (kod bilan olingan vaqtinchalik ruxsat); saqlash, Excel va yangi suhbat — har safar kod
 * («code» maydoni yoki «X-Chat-Code»). Qayerda so'ralishi — Sozlamalar › Chat kodi.
 */
@Roles(UserRole.ADMIN)
@Controller('source-chat')
export class SourceChatController {
  constructor(
    private readonly service: SourceChatService,
    private readonly pin: ChatPinService,
  ) {}

  // ─────────── Chat kodi ───────────

  @Get('pin/status')
  async pinStatus(@Headers('x-chat-token') token: string | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.pin.status(token, userId) };
  }

  @Post('pin/unlock')
  @HttpCode(HttpStatus.OK)
  async unlock(@Body() body: { code?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.pin.unlock(body?.code, userId) };
  }

  /** Sozlamalar › Chat kodi */
  @Get('pin')
  async pinConfig() {
    return { data: await this.pin.config() };
  }

  @Put('pin')
  async pinUpdate(@Body() body: { currentCode?: unknown; newCode?: unknown; require?: unknown; ttlMinutes?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.pin.update(body, userId) };
  }

  // ─────────── Savol ───────────

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async ask(@Body() body: { text?: unknown; context?: unknown; threadId?: unknown; code?: unknown }, @Headers('x-chat-token') token: string | undefined, @CurrentUser('id') userId: string) {
    await this.pin.assertUse(token, userId);
    const id = typeof body?.threadId === 'string' ? body.threadId : '';
    const exists = id ? (await this.service.store(userId).threads()).some((t) => t.id === id) : false;
    if (!exists) await this.pin.assertAction('newChat', body?.code, userId);
    return { data: await this.service.ask(body, userId) };
  }

  // ─────────── Suhbatlar ───────────

  @Get('threads')
  async threads(@CurrentUser('id') userId: string, @Query('q') q: string | undefined, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).list(q) };
  }

  @Post('threads')
  @HttpCode(HttpStatus.OK)
  async create(@CurrentUser('id') userId: string, @Body() body: { title?: unknown; code?: unknown }, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    await this.pin.assertAction('newChat', (body as { code?: unknown })?.code, userId);
    return { data: await this.service.store(userId).create(body?.title) };
  }

  /** Hamma suhbatlarni o'chirish (?keepPinned=1 — qadalganlar qoladi) */
  @Delete('threads')
  async deleteAll(@CurrentUser('id') userId: string, @Query('keepPinned') keepPinned: string | undefined, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).deleteAll({ keepPinned: keepPinned === '1' || keepPinned === 'true' }) };
  }

  @Get('threads/:id')
  async thread(@CurrentUser('id') userId: string, @Param('id') id: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).get(id) };
  }

  @Patch('threads/:id')
  async update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() body: { title?: unknown; pinned?: unknown }, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).update(id, body) };
  }

  @Delete('threads/:id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).delete(id) };
  }

  @Post('threads/:id/clear')
  @HttpCode(HttpStatus.OK)
  async clear(@CurrentUser('id') userId: string, @Param('id') id: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).clear(id) };
  }

  @Delete('threads/:id/items/:itemId')
  async removeItem(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).removeItem(id, itemId) };
  }

  @Get('threads/:id/items/:itemId/text')
  async itemText(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('itemId') itemId: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: { text: await this.service.itemText(userId, id, itemId) } };
  }

  @Get('threads/:id/export')
  async exportThread(@CurrentUser('id') userId: string, @Param('id') id: string, @Res() response: Response, @Headers('x-chat-token') chatToken: string | undefined, @Headers('x-chat-code') chatCode: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    await this.pin.assertAction('save', chatCode, userId);
    const { buffer, filename } = await this.service.exportThread(userId, id);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  // ─────────── Saqlanganlar ───────────

  @Get('saved')
  async saved(@CurrentUser('id') userId: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).saved() };
  }

  @Post('saved')
  @HttpCode(HttpStatus.OK)
  async save(@CurrentUser('id') userId: string, @Body() body: { threadId?: unknown; itemId?: unknown; note?: unknown; code?: unknown }, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    await this.pin.assertAction('save', (body as { code?: unknown })?.code, userId);
    return { data: await this.service.store(userId).save(body) };
  }

  @Get('saved/export')
  async exportSaved(@CurrentUser('id') userId: string, @Query('ids') ids: string | undefined, @Res() response: Response, @Headers('x-chat-token') chatToken: string | undefined, @Headers('x-chat-code') chatCode: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    await this.pin.assertAction('save', chatCode, userId);
    const { buffer, filename } = await this.service.exportSaved(userId, ids);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Delete('saved')
  async clearSaved(@CurrentUser('id') userId: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).clearSaved() };
  }

  @Patch('saved/:id')
  async updateSaved(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() body: { note?: unknown }, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).updateSaved(id, body) };
  }

  @Delete('saved/:id')
  async unsave(@CurrentUser('id') userId: string, @Param('id') id: string, @Headers('x-chat-token') chatToken: string | undefined) {
    await this.pin.assertUse(chatToken, userId);
    return { data: await this.service.store(userId).unsave(id) };
  }
}