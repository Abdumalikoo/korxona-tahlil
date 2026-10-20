import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { UserRole, type StockDocKind } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { WarehouseActs } from './warehouse.acts';
import { WarehouseCounts } from './warehouse.counts';
import { WarehouseDemo } from './warehouse.demo';
import { WarehousePostal, type PostalInput } from './warehouse.postal';
import { WarehouseService } from './warehouse.service';
import { WarehouseTemplates } from './warehouse.template';
import type { CountInput, CountSaveInput, DocInput, ItemInput } from './warehouse.types';

/**
 * Ombor: TMZ va asosiy vositalar.
 * Ko'rish — hamma kirgan foydalanuvchi; kiritish va bekor qilish — administrator va Omborchi
 * (Omborchi ID kod + PIN bilan kiradi va faqat shu bo'limni ko'radi — AccessGuard).
 */
@Controller('warehouse')
export class WarehouseController {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly acts: WarehouseActs,
    private readonly counts: WarehouseCounts,
    private readonly postal: WarehousePostal,
    private readonly demo: WarehouseDemo,
    private readonly templates: WarehouseTemplates,
  ) {}

  private sendDocx(response: Response, file: { buffer: Buffer; filename: string }) {
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(file.buffer);
  }

  // ═══════════ Ma'lumotnomalar va umumiy ko'rinish ═══════════

  @Get('lookups')
  async lookups() {
    return { data: await this.warehouse.lookups() };
  }

  /** Oluvchi / mas'ul tanlash: ?search= */
  @Get('employees')
  async employees(@Query('search') search?: string) {
    return { data: await this.warehouse.employees(search) };
  }

  /** Rahbariyat uchun: qoldiq qiymati, asosiy vositalar, davr kirim-chiqimi, kimda nima bor (?from&to — YYYY-MM-DD) */
  @Get('overview')
  async overview(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.warehouse.overview(from, to) };
  }

  /** Oldingi kirimlardagi yetkazib beruvchilar (kirim formasida tanlash uchun) */
  @Get('suppliers')
  async suppliers() {
    return { data: await this.warehouse.suppliers() };
  }

  /** Kimda nima bor: ?holderPinfl | holderName | departmentId | regionCode */
  @Get('holdings')
  async holdings(
    @Query('holderPinfl') holderPinfl?: string,
    @Query('holderName') holderName?: string,
    @Query('departmentId') departmentId?: string,
    @Query('regionCode') regionCode?: string,
  ) {
    return { data: await this.warehouse.holdings({ holderPinfl, holderName, departmentId, regionCode }) };
  }

  /** Kimda nima bor — Word kartochka (o'sha parametrlar) */
  @Get('holdings/card')
  async holdingsCard(
    @Res() response: Response,
    @Query('holderPinfl') holderPinfl?: string,
    @Query('holderName') holderName?: string,
    @Query('departmentId') departmentId?: string,
    @Query('regionCode') regionCode?: string,
  ) {
    this.sendDocx(response, await this.acts.buildCard({ holderPinfl, holderName, departmentId, regionCode }));
  }

  // ═══════════ Demo (faqat administrator) ═══════════

  /** Demo holati: buyumlar, hujjatlar, asosiy vositalar, pochta */
  @Roles(UserRole.ADMIN)
  @Get('demo')
  async demoStatus() {
    return { data: await this.demo.status() };
  }

  /** 35 ta buyum va oxirgi 3 oyning hujjatlari — kirimlar Xarajatlarga ham yoziladi */
  @Roles(UserRole.ADMIN)
  @Post('demo')
  async demoCreate(@CurrentUser('id') userId: string) {
    return { data: await this.demo.create(userId) };
  }

  /** Demoni butunlay o'chirish */
  @Roles(UserRole.ADMIN)
  @Delete('demo')
  @HttpCode(HttpStatus.OK)
  async demoRemove(@CurrentUser('id') userId: string) {
    return { data: await this.demo.remove(userId) };
  }

  // ═══════════ Dalolatnoma shabloni ═══════════

  @Get('act-template')
  async actTemplate() {
    return { data: await this.templates.get() };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Patch('act-template')
  async actTemplateSave(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.templates.save(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('act-template/reset')
  @HttpCode(HttpStatus.OK)
  async actTemplateReset(@CurrentUser('id') userId: string) {
    return { data: await this.templates.reset(userId) };
  }

  /** Namuna: { kind, regionCode?, template? } — saqlanmagan shablonni ham ko'rish mumkin */
  @Post('act-template/sample')
  @HttpCode(HttpStatus.OK)
  async actTemplateSample(@Body() body: { kind?: string; regionCode?: number | null; template?: unknown }, @Res() response: Response) {
    const kinds: StockDocKind[] = ['ISSUE', 'RETURN', 'TRANSFER', 'WRITE_OFF', 'RECEIPT'];
    const kind = kinds.includes(body?.kind as StockDocKind) ? (body.kind as StockDocKind) : 'ISSUE';
    const region = typeof body?.regionCode === 'number' && Number.isInteger(body.regionCode) ? body.regionCode : null;
    this.sendDocx(response, await this.acts.buildSample(kind, region, body?.template));
  }

  // ═══════════ Pochta to'lovlari ═══════════

  /** ?from&to (YYYY-MM-DD) — to'lovlar, jami, korxonalar */
  @Get('postal')
  async postalList(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.postal.list(from, to) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('postal')
  async postalCreate(@Body() body: PostalInput, @CurrentUser('id') userId: string) {
    return { data: await this.postal.create(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete('postal/:id')
  async postalCancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.postal.cancel(id, userId) };
  }

  // ═══════════ Inventarizatsiya ═══════════

  @Get('counts')
  async countList() {
    return { data: await this.counts.list() };
  }

  @Get('counts/:id')
  async count(@Param('id') id: string) {
    return { data: await this.counts.get(id) };
  }

  @Get('counts/:id/act')
  async countAct(@Param('id') id: string, @Res() response: Response) {
    this.sendDocx(response, await this.acts.buildCount(id));
  }

  /** Yangi sanoq: faol TMZ va omborda turgan asosiy vositalar ro'yxati tayyorlanadi */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('counts')
  async countCreate(@Body() body: CountInput, @CurrentUser('id') userId: string) {
    return { data: await this.counts.create(body, userId) };
  }

  /** Sanalganlarni saqlash (qisman) */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Patch('counts/:id')
  async countSave(@Param('id') id: string, @Body() body: CountSaveInput) {
    return { data: await this.counts.save(id, body) };
  }

  /** Yakunlash: kamomad — hisobdan chiqarish, ortiqcha — kirim (xarajatsiz) */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('counts/:id/finish')
  @HttpCode(HttpStatus.OK)
  async countFinish(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.counts.finish(id, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete('counts/:id')
  async countRemove(@Param('id') id: string) {
    return { data: await this.counts.remove(id) };
  }

  // ═══════════ Buyumlar ═══════════

  /** ?kind=TMZ|ASSET&search=&all=1 (faol bo'lmaganlar ham) */
  @Get('items')
  async items(@Query('kind') kind?: string, @Query('search') search?: string, @Query('all') all?: string) {
    return { data: await this.warehouse.items({ kind, search, all: all === '1' || all === 'true' }) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('items')
  async createItem(@Body() body: ItemInput) {
    return { data: await this.warehouse.createItem(body) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Patch('items/:id')
  async updateItem(@Param('id') id: string, @Body() body: ItemInput) {
    return { data: await this.warehouse.updateItem(id, body) };
  }

  /** Hujjatda ishlatilgan bo'lsa — faolsizlantiriladi */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Delete('items/:id')
  async removeItem(@Param('id') id: string) {
    return { data: await this.warehouse.removeItem(id) };
  }

  // ═══════════ Hujjatlar ═══════════

  /** ?kind=RECEIPT|ISSUE|RETURN|TRANSFER|WRITE_OFF&from&to&search&departmentId&regionCode */
  @Get('docs')
  async docs(
    @Query('kind') kind?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('regionCode') regionCode?: string,
  ) {
    return { data: await this.warehouse.docs({ kind, from, to, search, departmentId, regionCode }) };
  }

  @Get('docs/:id')
  async doc(@Param('id') id: string) {
    return { data: await this.warehouse.doc(id) };
  }

  /** Dalolatnoma — ekranda ko'rish uchun (Word bilan bir xil mazmun) */
  @Get('docs/:id/act-view')
  async actView(@Param('id') id: string) {
    return { data: await this.acts.view(id) };
  }

  /** Word dalolatnoma */
  @Get('docs/:id/act')
  async act(@Param('id') id: string, @Res() response: Response) {
    const file = await this.acts.build(id);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(file.buffer);
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('docs')
  async createDoc(@Body() body: DocInput, @CurrentUser('id') userId: string, @CurrentUser('role') role?: string) {
    // Kirimni xaridchi yozadi, omborchi «Qabul qilish» sahifasida tasdiqlaydi (receipts) — qo'lda kirim yozilmaydi
    if (body?.kind === 'RECEIPT' && role === UserRole.SKLADCHI) throw new ForbiddenException("Kirimni xaridchi yozadi. «Qabul qilish» sahifasida kelgan tovarni qabul qiling");
    return { data: await this.warehouse.createDoc(body, userId) };
  }

  /** Bekor qilish (kirim — xarajatlar ham bekor bo'ladi) */
  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Post('docs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelDoc(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') role?: string) {
    // Kirim — moliyaviy yozuv (xarajat) yaratadi: omborchi bekor qila olmaydi, administrator tuzatadi
    if (role === UserRole.SKLADCHI && (await this.warehouse.docKind(id)) === 'RECEIPT') throw new ForbiddenException("Kirimni faqat administrator bekor qiladi. Xato bo'lsa administratorga ayting");
    return { data: await this.warehouse.cancelDoc(id, userId) };
  }

  // ═══════════ Asosiy vositalar ═══════════

  /** ?status=IN_STOCK|IN_USE|WRITTEN_OFF&departmentId&regionCode&holder&itemId&search */
  @Get('assets')
  async assets(
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('regionCode') regionCode?: string,
    @Query('holder') holder?: string,
    @Query('itemId') itemId?: string,
    @Query('search') search?: string,
  ) {
    return { data: await this.warehouse.assets({ status, departmentId, regionCode, holder, itemId, search }) };
  }

  /** Bitta asosiy vosita va harakat tarixi */
  @Get('assets/:id')
  async asset(@Param('id') id: string) {
    return { data: await this.warehouse.asset(id) };
  }

  @Roles(UserRole.ADMIN, UserRole.SKLADCHI)
  @Patch('assets/:id')
  async updateAsset(@Param('id') id: string, @Body() body: { serialNo?: string | null; note?: string | null; name?: string }) {
    return { data: await this.warehouse.updateAsset(id, body ?? {}) };
  }
}