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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { VehicleQuarterlyService } from './vehicles.quarterly';
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
    private readonly quarterly: VehicleQuarterlyService,
  ) {}

  // ═══════════ Choraklik hisobot (24-ilova): jihozlash → ta'mirlash, qolgani — statistika ═══════════

  @Get('quarterly')
  async quarterlyList() {
    return { data: await this.quarterly.list() };
  }

  /** Bo'sh shablon (mashinalar ro'yxati bilan) */
  @Get('quarterly/template')
  async quarterlyTemplate(@Query('year') year: string | undefined, @Query('quarter') quarter: string | undefined, @Res() response: Response) {
    const { buffer, filename } = await this.quarterly.template(year, quarter);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni o'qish — hech narsa yozilmaydi */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('quarterly/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async quarterlyAnalyze(@UploadedFile() file: Express.Multer.File, @Query('scale') scale?: string) {
    return { data: await this.quarterly.analyze(file, scale) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('quarterly/commit')
  @HttpCode(HttpStatus.OK)
  async quarterlyCommit(@Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.quarterly.commit(body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete('quarterly/:key')
  @HttpCode(HttpStatus.OK)
  async quarterlyRemove(@Param('key') key: string, @CurrentUser('id') userId: string) {
    return { data: await this.quarterly.remove(key, userId) };
  }

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

  // ═══════════ Bo'limlarga biriktirish ═══════════

  /** Mashinalar, joyi va davrdagi xarajati (oylar bilan) */
  @Get('places')
  async places(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.vehicles.places(from, to) };
  }

  /** Mashina(lar)ni Markaz bo'limi / hudud / yo'nalishga biriktirish — xarajatlari ko'chadi, keyingilari avtomatik */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('places')
  @HttpCode(HttpStatus.OK)
  async setPlaces(@Body() body: { items?: unknown; fromPeriod?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.vehicles.setPlaces(body ?? {}, userId) };
  }

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