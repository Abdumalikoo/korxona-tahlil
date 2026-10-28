import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ExcludedIncomesService } from './excluded-incomes.service';

type Body_ = { kind?: unknown; date?: unknown; amountTiyin?: unknown; note?: unknown };

/**
 * Hisobga olinmaydigan tushumlar: /api/excluded-incomes — ko'rish (administrator, kuzatuvchi), kiritish (administrator).
 * Daromadga qo'shilmaydi.
 */
@Controller('excluded-incomes')
export class ExcludedIncomesController {
  constructor(private readonly svc: ExcludedIncomesService) {}

  @Roles(UserRole.ADMIN, UserRole.VIEWER)
  @Get()
  async list(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.svc.list(from, to) };
  }

  @Roles(UserRole.ADMIN, UserRole.VIEWER)
  @Get('export')
  async export(@Query('from') from: string, @Query('to') to: string, @Res() response: Response) {
    const f = await this.svc.export(from, to);
    response.setHeader('Content-Type', f.mime);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(f.buffer);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: Body_) {
    return { data: await this.svc.create(user, body) };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Body_) {
    return { data: await this.svc.update(user, id, body) };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.svc.remove(user, id) };
  }
}
