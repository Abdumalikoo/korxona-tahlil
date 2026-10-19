import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { TasksService, type TaskInput } from './tasks.service';

/** Topshiriqlar: xodimga muddatli ish, Telegramga avtomatik eslatma */
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** ?status=active|overdue|done|cancelled|all */
  @Get()
  async list(@Query('status') status?: string) {
    return { data: await this.tasks.list({ status }) };
  }

  @Get('employees')
  async employees(@Query('search') search?: string) {
    return { data: await this.tasks.employees(search) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { data: await this.tasks.get(id) };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() body: TaskInput, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.create(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: TaskInput, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.update(id, body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/done')
  async done(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.setStatus(id, 'DONE', userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.setStatus(id, 'CANCELLED', userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/reopen')
  async reopen(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.setStatus(id, 'OPEN', userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/remind')
  async remind(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.remindNow(id, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.tasks.remove(id, userId) };
  }
}