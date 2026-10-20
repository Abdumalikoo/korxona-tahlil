import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { VehiclesDemo } from './vehicles.demo';
import { VehicleFuelImportService, type FuelCommitInput } from './vehicles.fuel-import';
import { VehiclesService } from './vehicles.service';
import type { RecordInput, VehicleInput } from './vehicles.types';

/**
 * Mashinalar: yoqilg'i, moyka, ta'mirlash — Xarajatlar › Doimiy.
 * Kiritish — administrator va Omborchi (ID kod bilan kiradi; faqat Ombor va Mashinalar bo'limi).
 */
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly demo: VehiclesDemo,
    private readonly fuelImport: VehicleFuelImportService,
  ) {}

  // ═══════════ Yoqilg'i hisoboti (AZS «ОТЧЕТ ПО ПРОДАЖАМ») ═══════════

  /** Faylni tahlil qilish — hech narsa yozilmaydi */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('fuel-import/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async fuelAnalyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.fuelImport.analyze(file) };
  }

  /** Tanlangan kartalar bo'yicha quyishlarni yozish */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('fuel-import/commit')
  @HttpCode(HttpStatus.OK)
  async fuelCommit(@Body() body: FuelCommitInput, @CurrentUser('id') userId: string) {
    return { data: await this.fuelImport.commit(body, userId) };
  }

  // ═══════════ Ma'lumotnomalar va tahlil ═══════════

  /** Hududlar, bo'limlar, yoqilg'i va xarajat turlari */
  @Get('lookups')
  async lookups() {
    const data = await this.vehicles.lookups();
    return { data };
  }


  /** Oldingi AZS / moyka / servis nomlari (?kind=FUEL…) — kiritishda tanlash uchun */
  @Get('counterparties')
  async counterparties(@Query('kind') kind?: string) {
    return { data: await this.vehicles.counterparties(kind) };
  }

  /** Davr tahlili (?from=YYYY-MM&to=YYYY-MM) */
  @Get('summary')
  async summary(@Query('from') from: string, @Query('to') to: string) {
    const data = await this.vehicles.summary(from, to);
    return { data };
  }

  // ═══════════ Xarajat yozuvlari ═══════════

  /** Oy bo'yicha yozuvlar (?period&vehicleId&kind) */
  @Get('records')
  async records(
    @Query('period') period?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('kind') kind?: string,
  ) {
    const data = await this.vehicles.records({ period, vehicleId, kind });
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('records')
  async createRecord(@Body() body: RecordInput, @CurrentUser('id') userId: string) {
    const data = await this.vehicles.createRecord(body, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Patch('records/:id')
  async updateRecord(
    @Param('id') id: string,

    @Body() body: RecordInput,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.vehicles.updateRecord(id, body, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete('records/:id')
  @HttpCode(HttpStatus.OK)
  async removeRecord(@Param('id') id: string) {
    const data = await this.vehicles.removeRecord(id);
    return { data };
  }

  // ═══════════ Demo (faqat administrator) ═══════════

  /** Demo holati: nechta demo mashina va xarajat bor */
  @Roles(UserRole.ADMIN)
  @Get('demo')
  async demoStatus() {
    return { data: await this.demo.status() };
  }

  /** 13 ta namunaviy mashina (4 guruh) va oxirgi 3 oy xarajatlari — Xarajatlarga ham yoziladi */
  @Roles(UserRole.ADMIN)
  @Post('demo')
  async demoCreate(@CurrentUser('id') userId: string) {
    return { data: await this.demo.create(userId) };
  }

  /** Demoni butunlay o'chirish: mashinalar, yozuvlar va Xarajatlardagi yozuvlar */
  @Roles(UserRole.ADMIN)
  @Delete('demo')
  @HttpCode(HttpStatus.OK)
  async demoRemove(@CurrentUser('id') userId: string) {
    return { data: await this.demo.remove(userId) };
  }

  // ═══════════ Mashinalar ═══════════

  /** Mashinalar ro'yxati va tanlangan oy summalari (?period=YYYY-MM) */
  @Get()
  async list(@Query('period') period?: string) {
    const data = await this.vehicles.list(period);
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post()
  async create(@Body() body: VehicleInput, @CurrentUser('id') userId: string) {
    const data = await this.vehicles.create(body, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: VehicleInput) {
    const data = await this.vehicles.update(id, body);
    return { data };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const data = await this.vehicles.remove(id);
    return { data };
  }
}