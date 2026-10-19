import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { ControlsService } from './controls.service';
import { ReactionsReportService } from './reactions-report.service';
import { ReactionsSlidesService } from './reactions-slides.service';
import { ReactionsService } from './reactions.service';
import type { CreateReactionInput, ToControlInput, UpdateReactionInput } from './reactions.types';

function sendFile(response: Response, buffer: Buffer, filename: string, type: string) {
  response.setHeader('Content-Type', type);
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  response.send(buffer);
}

/** Munosabat: nomlangan savat — belgilangan moddalar, muddat, mas'ullar, hisobot va slaydlar */
@Controller('reactions')
export class ReactionsController {
  constructor(
    private readonly reactions: ReactionsService,
    private readonly controls: ControlsService,
    private readonly report: ReactionsReportService,
    private readonly slides: ReactionsSlidesService,
  ) {}

  /** Ro'yxat (?status=OPEN|CLOSED|CONTROL) */
  @Get()
  async list(@Query('status') status?: string) {
    return { data: await this.reactions.list(status) };
  }

  /** Mas'ul tanlash uchun xodimlar (?search=) */
  @Get('employees')
  async employees(@Query('search') search?: string) {
    return { data: await this.reactions.employees(search) };
  }

  /** Qo'lda modda qo'shish uchun: hududlar, bo'limlar, xarajat guruhlari, daromad turlari, mashinalar */
  @Get('lookups')
  async lookups() {
    return { data: await this.reactions.lookups() };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.reactions.detail(id) };
  }

  @Get(':id/report')
  async excel(@Param('id') id: string, @Res() response: Response) {
    const { buffer, filename } = await this.report.build(id);
    sendFile(response, buffer, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  @Get(':id/slides')
  async pptx(@Param('id') id: string, @Res() response: Response) {
    const { buffer, filename } = await this.slides.build(id);
    sendFile(response, buffer, filename, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }

  /** Nazoratga o'tkazishdan oldin: har modda uchun taklif qilingan oylik chegara */
  @Get(':id/control-preview')
  async controlPreview(@Param('id') id: string) {
    return { data: await this.controls.preview(id) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: CreateReactionInput, @CurrentUser('id') userId: string) {
    return { data: await this.reactions.create(body, userId) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: UpdateReactionInput) {
    return { data: await this.reactions.update(id, body) };
  }

  @Post(':id/control')
  @Roles(UserRole.ADMIN)
  async toControl(@Param('id') id: string, @Body() body: ToControlInput, @CurrentUser('id') userId: string) {
    return { data: await this.controls.fromReaction(id, body, userId) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.reactions.remove(id);
  }
}