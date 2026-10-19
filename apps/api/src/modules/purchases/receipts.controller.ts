import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { ReceiptsService, type ReceiptInput } from './receipts.service';

/**
 * Omborga qabul: xaridchi yozadi, omborchi qabul qiladi.
 * Ikkala rolga ochiq (role-access.ts), lekin har amal faqat o'z roliga.
 */
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('summary')
  async summary() {
    return { data: await this.receipts.summary() };
  }

  /** ?status=pending|accepted|rejected|all &purchaseId= */
  @Get()
  async list(@Query('status') status?: string, @Query('purchaseId') purchaseId?: string) {
    return { data: await this.receipts.list({ status, purchaseId }) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { data: await this.receipts.get(id) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post()
  async create(@Body() body: ReceiptInput, @CurrentUser('id') userId: string) {
    return { data: await this.receipts.create(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post(':id/withdraw')
  async withdraw(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.receipts.withdraw(id, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post(':id/accept')
  async accept(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.receipts.accept(id, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.receipts.reject(id, body?.reason, userId) };
  }
}