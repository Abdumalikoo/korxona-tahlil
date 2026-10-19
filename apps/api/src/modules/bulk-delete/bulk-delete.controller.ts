import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { BulkDeleteService, type DeleteRequest } from './bulk-delete.service';

/** Yagona «O'chirish»: avval ko'rib chiqish, keyin tasdiqlab o'chirish (administrator va Hududchi) */
@Controller('bulk-delete')
export class BulkDeleteController {
  constructor(private readonly bulk: BulkDeleteService) {}

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
}