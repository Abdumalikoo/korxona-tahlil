import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { CreateWorkerDto, ResetPinDto, UpdateWorkerDto } from './dto/users.dto';
import { UsersService } from './users.service';

/** Sozlamalar › Foydalanuvchilar — faqat administrator */
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list() {
    return { data: await this.users.list() };
  }

  /** Qo'shish mumkin bo'lgan ishchi rollar va ularga ochiq bo'limlar */
  @Get('roles')
  roles() {
    return { data: this.users.roles() };
  }

  /** Yangi ishchi: ID kod avtomatik, PIN javobda BIR MARTA ko'rsatiladi */
  @Post()
  async create(@Body() dto: CreateWorkerDto, @CurrentUser('id') actorId: string) {
    return { data: await this.users.create(dto, actorId) };
  }

  /** Qachon kirgani va boshqa harakatlar */
  @Get(':id/history')
  async history(@Param('id') id: string) {
    return { data: await this.users.history(id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkerDto, @CurrentUser('id') actorId: string) {
    return { data: await this.users.update(id, dto, actorId) };
  }

  @Post(':id/reset-pin')
  @HttpCode(HttpStatus.OK)
  async resetPin(@Param('id') id: string, @Body() dto: ResetPinDto, @CurrentUser('id') actorId: string) {
    return { data: await this.users.resetPin(id, dto, actorId) };
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  async unlock(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return { data: await this.users.unlock(id, actorId) };
  }
}