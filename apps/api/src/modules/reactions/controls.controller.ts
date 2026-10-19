import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { ControlsService } from './controls.service';
import type { CreateControlInput, UpdateControlInput } from './reactions.types';

/** Nazorat: moddalar har oy avtomatik hisoblanadi va chegara bilan solishtiriladi */
@Controller('controls')
export class ControlsController {
  constructor(private readonly controls: ControlsService) {}

  /** ?asOf=YYYY-MM — umumiy «Davr» oyi: o'tgan oy bo'lsa, o'sha oy oxiridagi holat */
  @Get()
  async list(@Query('asOf') asOf?: string) {
    return { data: await this.controls.list(undefined, asOf) };
  }

  @Get(':id')
  async one(@Param('id') id: string, @Query('asOf') asOf?: string) {
    return { data: await this.controls.one(id, asOf) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: CreateControlInput, @CurrentUser('id') userId: string) {
    return { data: await this.controls.create(body, userId) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: UpdateControlInput) {
    return { data: await this.controls.update(id, body) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.controls.remove(id);
  }
}