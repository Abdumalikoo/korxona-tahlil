import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import type { Response } from 'express';
import { ExpensesService } from './expenses.service';
import { ExpensesExportService } from './expenses-export.service';

@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly exportService: ExpensesExportService,
  ) {}

  // ─────────── Tahlil (":id" dan oldin turishi shart) ───────────

  @Get('export')
  async exportExcel(@Query() query: QueryExpenseDto, @Res() response: Response) {
    const { buffer, filename } = await this.exportService.build(query);

    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  @Get('similar')
  async similar(
    @Query('date') date: string,
    @Query('amountTiyin', ParseIntPipe) amountTiyin: number,
    @Query('categoryCode') categoryCode: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const data = await this.expenses.findSimilar({
      date,
      amountTiyin,
      categoryCode,
      excludeId,
    });
    return { data };
  }

  /** Savatdagi yozuvlar */
  @Get('deleted')
  async deleted(@Query('period') period?: string) {
    const data = await this.expenses.findDeleted(period);
    return { data };
  }

  /** Filtrga nechta yozuv mos kelishi */
  @Get('count')
  async count(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.countByFilter(query);
    return { data };
  }

  @Get('spikes')
  async spikes(
    @Query('period') period: string,
    @Query('threshold', new DefaultValuePipe(30), ParseIntPipe) threshold: number,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.expenses.spikes(period, threshold, departmentId);
    return { data };
  }

  @Get('summary/category')
  async summaryByCategory(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.summaryByCategory(query);
    return { data };
  }

  @Get('summary/department')
  async summaryByDepartment(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.summaryByDepartment(query);
    return { data };
  }

  @Get('summary/region')
  async summaryByRegion(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.summaryByRegion(query);
    return { data };
  }

  @Get('summary/behavior')
  async summaryByBehavior(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.summaryByBehavior(query);
    return { data };
  }

  @Get('trend')
  async trend(
    @Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.expenses.monthlyTrend(Math.min(months, 60), departmentId);
    return { data };
  }

  @Get('comparison')
  async comparison(
    @Query('period') period: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.expenses.comparison(period, departmentId);
    return { data };
  }

  // ─────────── CRUD ───────────

  @Get()
  async findAll(@Query() query: QueryExpenseDto) {
    const result = await this.expenses.findAll(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.expenses.findOne(id);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateExpenseDto, @CurrentUser('id') userId: string) {
    const data = await this.expenses.create(dto, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    const data = await this.expenses.update(id, dto);
    return { data };
  }

  /** Bir nechta yozuvni birdan ochirish */
  @Roles(UserRole.ADMIN)
  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  async removeMany(@Body() body: { ids: string[] }) {
    const data = await this.expenses.removeMany(body?.ids ?? []);
    return { data };
  }

  /** Filtrga mos hamma yozuvni ochirish */
  @Roles(UserRole.ADMIN)
  @Post('delete-by-filter')
  @HttpCode(HttpStatus.OK)
  async removeByFilter(@Query() query: QueryExpenseDto) {
    const data = await this.expenses.removeByFilter(query);
    return { data };
  }

  /** Savatdan tiklash */
  @Roles(UserRole.ADMIN)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('id') id: string) {
    const data = await this.expenses.restore(id);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const data = await this.expenses.remove(id);
    return { data };
  }
}
