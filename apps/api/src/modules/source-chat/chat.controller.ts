import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { SourceChatService } from './chat.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Chat › Manba chati: /api/source-chat/… — tizimdagi manbalardan javob (faqat administrator).
 * Suhbatlar (threads), tozalash, saqlanganlar, Excel'ga yuklab olish — har foydalanuvchiniki alohida.
 */
@Roles(UserRole.ADMIN)
@Controller('source-chat')
export class SourceChatController {
  constructor(private readonly service: SourceChatService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async ask(@Body() body: { text?: unknown; context?: unknown; threadId?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.ask(body, userId) };
  }

  // ─────────── Suhbatlar ───────────

  @Get('threads')
  async threads(@CurrentUser('id') userId: string, @Query('q') q?: string) {
    return { data: await this.service.store(userId).list(q) };
  }

  @Post('threads')
  @HttpCode(HttpStatus.OK)
  async create(@CurrentUser('id') userId: string, @Body() body: { title?: unknown }) {
    return { data: await this.service.store(userId).create(body?.title) };
  }

  /** Hamma suhbatlarni o'chirish (?keepPinned=1 — qadalganlar qoladi) */
  @Delete('threads')
  async deleteAll(@CurrentUser('id') userId: string, @Query('keepPinned') keepPinned?: string) {
    return { data: await this.service.store(userId).deleteAll({ keepPinned: keepPinned === '1' || keepPinned === 'true' }) };
  }

  @Get('threads/:id')
  async thread(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.service.store(userId).get(id) };
  }

  @Patch('threads/:id')
  async update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() body: { title?: unknown; pinned?: unknown }) {
    return { data: await this.service.store(userId).update(id, body) };
  }

  @Delete('threads/:id')
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.service.store(userId).delete(id) };
  }

  @Post('threads/:id/clear')
  @HttpCode(HttpStatus.OK)
  async clear(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.service.store(userId).clear(id) };
  }

  @Delete('threads/:id/items/:itemId')
  async removeItem(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('itemId') itemId: string) {
    return { data: await this.service.store(userId).removeItem(id, itemId) };
  }

  @Get('threads/:id/items/:itemId/text')
  async itemText(@CurrentUser('id') userId: string, @Param('id') id: string, @Param('itemId') itemId: string) {
    return { data: { text: await this.service.itemText(userId, id, itemId) } };
  }

  @Get('threads/:id/export')
  async exportThread(@CurrentUser('id') userId: string, @Param('id') id: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.exportThread(userId, id);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  // ─────────── Saqlanganlar ───────────

  @Get('saved')
  async saved(@CurrentUser('id') userId: string) {
    return { data: await this.service.store(userId).saved() };
  }

  @Post('saved')
  @HttpCode(HttpStatus.OK)
  async save(@CurrentUser('id') userId: string, @Body() body: { threadId?: unknown; itemId?: unknown; note?: unknown }) {
    return { data: await this.service.store(userId).save(body) };
  }

  @Get('saved/export')
  async exportSaved(@CurrentUser('id') userId: string, @Query('ids') ids: string | undefined, @Res() response: Response) {
    const { buffer, filename } = await this.service.exportSaved(userId, ids);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Delete('saved')
  async clearSaved(@CurrentUser('id') userId: string) {
    return { data: await this.service.store(userId).clearSaved() };
  }

  @Patch('saved/:id')
  async updateSaved(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() body: { note?: unknown }) {
    return { data: await this.service.store(userId).updateSaved(id, body) };
  }

  @Delete('saved/:id')
  async unsave(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { data: await this.service.store(userId).unsave(id) };
  }
}