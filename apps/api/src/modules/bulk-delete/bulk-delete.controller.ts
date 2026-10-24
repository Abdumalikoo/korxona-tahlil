import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { BulkDeleteService, type DeleteRequest } from './bulk-delete.service';
import { DeletePasswordService } from './delete-password.service';

/**
 * Yagona «O'chirish»: avval ko'rib chiqish, keyin tasdiqlab o'chirish (administrator va Hududchi).
 * «Hammasi» yoki 50 tadan ortiq yozuv — o'chirish paroli bilan (Sozlamalar › Xavfsizlik).
 */
@Controller('bulk-delete')
export class BulkDeleteController {
  constructor(
    private readonly bulk: BulkDeleteService,
    private readonly passwords: DeletePasswordService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() body: DeleteRequest, @CurrentUser('id') id: string, @CurrentUser('role') role: string) {
    return { data: await this.bulk.preview(body, { id, role }) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async execute(@Body() body: DeleteRequest, @CurrentUser('id') id: string, @CurrentUser('role') role: string) {
    return { data: await this.bulk.execute(body, { id, role }) };
  }

  /** O'chirish paroli holati (standartmi, qachon o'zgargan) */
  @Roles(UserRole.ADMIN)
  @Get('password')
  async passwordInfo() {
    return { data: await this.passwords.info() };
  }

  /** O'chirish parolini o'zgartirish: { current, next } */
  @Roles(UserRole.ADMIN)
  @Patch('password')
  async changePassword(@Body() body: { current?: unknown; next?: unknown }, @CurrentUser('id') id: string) {
    return { data: await this.passwords.change(body ?? {}, id) };
  }
}