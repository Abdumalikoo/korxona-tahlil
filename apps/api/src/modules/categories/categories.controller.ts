import {
    Body,
    Controller,
    DefaultValuePipe,
    Delete,
    Get,
    Param,
    ParseBoolPipe,
    Patch,
  Post,
    Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from './categories.service';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateCategoryDto } from './dto/create-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.categories.findAll(includeInactive);
    return { data };
  }

  @Get('tree')
  async findTree(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,

  ) {
    const data = await this.categories.findTree(includeInactive);
    return { data };
  }

  @Get('leaves')
  async findLeaves() {
    const data = await this.categories.findLeaves();
    return { data };
  }

  @Get('income')
  async findIncome(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.categories.findIncomeCategories(includeInactive);
    return { data };
  }

  /** Daromad xizmat turlari (arxivdagilari bilan) — har biri nechta yozuvda ishlatilgani */
  @Get('income/usage')
  async incomeUsage() {
    return { data: await this.categories.incomeUsage() };
  }

  /** Daromad xizmat turini arxivlash / qaytarish: { isActive } */
  @Roles(UserRole.ADMIN)
  @Patch('income/:code/active')
  async incomeActive(@Param('code') code: string, @Body() body: { isActive?: boolean }, @CurrentUser('id') userId: string) {
    const data = await this.categories.setIncomeActive(code, body?.isActive !== false);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'income_category', entityId: code, summary: `Daromad xizmat turi ${data.isActive ? 'qaytarildi' : 'arxivlandi'}: ${data.label}` });
    return { data };
  }

  /** Daromad xizmat turini o'chirish — faqat ishlatilmagan bo'lsa */
  @Roles(UserRole.ADMIN)
  @Delete('income/:code')
  async removeIncome(@Param('code') code: string, @CurrentUser('id') userId: string) {
    const data = await this.categories.removeIncome(code);
    await this.audit.log({ userId, action: 'DELETE', entity: 'income_category', entityId: code, summary: `Daromad xizmat turi o'chirildi: ${data.label}` });
    return { data };
  }

  @Get(':code')
  async findOne(@Param('code') code: string) {
    const data = await this.categories.findOne(code);
    return { data };
  }

  @Get(':code/path')
  async getPath(@Param('code') code: string) {
    const data = await this.categories.getPath(code);
    return { data };
  }


  @Get(':code/usage')
  async usage(@Param('code') code: string) {
    const data = await this.categories.getUsage(code);
    return { data };
  }

  /** Yangi daromad xizmat turi */
  @Roles(UserRole.ADMIN)
  @Post('income')
  async createIncome(@Body() dto: { label: string; code?: string }) {
    const data = await this.categories.createIncomeCategory(dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    const data = await this.categories.create(dto);
    return { data };
  }

  /** Xarajat moddasini o'chirish — faqat ishlatilmagan bo'lsa (aks holda arxivlash) */
  @Roles(UserRole.ADMIN)
  @Delete(':code')
  async remove(@Param('code') code: string, @CurrentUser('id') userId: string) {
    const data = await this.categories.remove(code);
    await this.audit.log({ userId, action: 'DELETE', entity: 'category', entityId: code, summary: `Xarajat moddasi o'chirildi: ${data.label}` });
    return { data };
  }

  /** Moddalar boshqaruvi: hamma faol moddalar (daraxt uchun) va har biriga yozilgan xarajatlar soni va summasi */
  @Get('manage/list')
  async manageList() {
    return { data: await this.categories.manageList() };
  }

  /** Moddani boshqa guruhga ko'chirish: { parentCode } (null — eng yuqori daraja) */
  @Roles(UserRole.ADMIN)
  @Patch(':code/move')
  async move(@Param('code') code: string, @Body() body: { parentCode?: unknown }, @CurrentUser('id') userId: string) {
    const data = await this.categories.move(code, body?.parentCode ?? null);
    if (data.from !== data.to) await this.audit.log({ userId, action: 'UPDATE', entity: 'category', entityId: code, summary: `Modda ko'chirildi: «${data.label}» ${data.from ?? 'yuqori daraja'} → ${data.to ?? 'yuqori daraja'}` });
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':code/archive')
  async archive(@Param('code') code: string) {
    const data = await this.categories.archive(code);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':code')
  async update(@Param('code') code: string, @Body() dto: UpdateCategoryDto) {
    const data = await this.categories.update(code, dto);
    return { data };
  }
}
