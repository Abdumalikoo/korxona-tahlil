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
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { CreateIncomeDto } from './dto/create-income.dto';
import { QueryIncomeDto } from './dto/query-income.dto';
import { UpdateIncomeDto } from './dto/update-income.dto';
import { IncomesService } from './incomes.service';

@Controller('incomes')
export class IncomesController {
  constructor(private readonly incomes: IncomesService) {}

  // ─────────── Tahlil (":id" dan oldin) ───────────

  @Get('summary/category')
  async summaryByCategory(@Query() query: QueryIncomeDto) {
    const data = await this.incomes.summaryByCategory(query);
    return { data };
  }


  @Get('summary/department')
  async summaryByDepartment(@Query() query: QueryIncomeDto) {
    const data = await this.incomes.summaryByDepartment(query);
    return { data };
  }

  @Get('abc')
  async abc(@Query() query: QueryIncomeDto) {
    const data = await this.incomes.abcAnalysis(query);
    return { data };
  }

  @Get('receivables')
  async receivables(@Query() query: QueryIncomeDto) {
    const data = await this.incomes.receivables(query);
    return { data };
  }

  @Get('trend')
  async trend(
    @Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number,
    @Query('departmentId') departmentId?: string,
  ) {
    const data = await this.incomes.monthlyTrend(Math.min(months, 60), departmentId);
    return { data };
  }

  @Get('comparison')
  async comparison(
    @Query('period') period: string,
    @Query('departmentId') departmentId?: string,

  ) {
    const data = await this.incomes.comparison(period, departmentId);
    return { data };
  }

  // ─────────── CRUD ───────────

  @Get()
  async findAll(@Query() query: QueryIncomeDto) {
    const result = await this.incomes.findAll(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.incomes.findOne(id);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateIncomeDto, @CurrentUser('id') userId: string) {
    const data = await this.incomes.create(dto, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateIncomeDto) {
    const data = await this.incomes.update(id, dto);
    return { data };
  }


  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    const data = await this.incomes.remove(id);
    return { data };
  }
}
