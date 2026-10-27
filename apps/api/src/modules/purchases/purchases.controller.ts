import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { WarehouseService } from '../warehouse/warehouse.service';
import type { ItemInput } from '../warehouse/warehouse.types';
import { PurchasesService, type PaymentInput, type PurchaseInput, type RequestInput, type SupplierInput } from './purchases.service';

/** Xarid: yetkazuvchilar, arizalar, birja va oddiy xaridlar, to'lovlar */
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly warehouse: WarehouseService,
  ) {}

  // ── Ma'lumotnomalar (static yo'llar :id dan oldin) ──
  @Get('lookups')
  async lookups() {
    return { data: await this.purchases.lookups() };
  }

  @Get('overview')
  async overview() {
    return { data: await this.purchases.overview() };
  }

  /** Tovarlar ro'yxati (xarid qatorini tanlash uchun) */
  @Get('items')
  async items(@Query('search') search?: string) {
    return { data: await this.warehouse.items({ search }) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post('items')
  async createItem(@Body() body: ItemInput) {
    return { data: await this.warehouse.createItem(body) };
  }

  @Get('last-prices')
  async lastPrices(@Query('ids') ids?: string) {
    return { data: await this.purchases.lastPrices(String(ids ?? '').split(',')) };
  }

  // ── Yetkazuvchilar ──
  @Get('suppliers')
  async suppliers() {
    return { data: await this.purchases.suppliers() };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post('suppliers')
  async createSupplier(@Body() body: SupplierInput, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.createSupplier(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Patch('suppliers/:id')
  async updateSupplier(@Param('id') id: string, @Body() body: SupplierInput & { isActive?: boolean }, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.updateSupplier(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Delete('suppliers/:id')
  async removeSupplier(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.removeSupplier(id, userId) };
  }

  // ── Arizalar ──
  @Get('requests')
  async requests(@Query('status') status?: string) {
    return { data: await this.purchases.requests({ status }) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post('requests')
  async createRequest(@Body() body: RequestInput, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.createRequest(body, userId) };
  }

  /** { status: 'IN_PROGRESS' | 'DONE' | 'REJECTED' | 'NEW', reason? } */
  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post('requests/:id/status')
  async requestStatus(@Param('id') id: string, @Body() body: { status?: string; reason?: string }, @CurrentUser('id') userId: string) {
    const allowed = ['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED'];
    const status = allowed.includes(String(body?.status)) ? (body!.status as 'NEW' | 'IN_PROGRESS' | 'DONE' | 'REJECTED') : 'NEW';
    return { data: await this.purchases.setRequestStatus(id, status, body?.reason, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Delete('requests/:id')
  async removeRequest(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.removeRequest(id, userId) };
  }

  // ── Xaridlar ──
  @Get()
  async list(@Query('status') status?: string, @Query('kind') kind?: string, @Query('supplierId') supplierId?: string, @Query('search') search?: string) {
    return { data: await this.purchases.list({ status, kind, supplierId, search }) };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { data: await this.purchases.get(id) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post()
  async create(@Body() body: PurchaseInput, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.create(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: PurchaseInput, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.update(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.cancel(id, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: PaymentInput, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.addPayment(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.XARIDCHI)
  @Delete(':id/payments/:paymentId')
  async removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string, @CurrentUser('id') userId: string) {
    return { data: await this.purchases.removePayment(id, paymentId, userId) };
  }
}