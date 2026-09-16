import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { Roles } from '../../common/decorators';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  // --------- Statistika (":pinfl" dan oldin) ---------

  @Get('stats')
  async stats() {
    const data = await this.employees.stats();
    return { data };
  }

  @Get('by-region')
  async byRegion() {
    const data = await this.employees.byRegion();
    return { data };
  }

  @Get('by-department')
  async byDepartment() {
    const data = await this.employees.byDepartment();
    return { data };
  }

  // --------- CRUD ---------

  @Get()
  async findAll(@Query() query: QueryEmployeeDto) {
    const result = await this.employees.findAll(query);
    return { data: result.items, meta: result.meta };
  }

  @Get(':pinfl')
  async findOne(@Param('pinfl') pinfl: string) {
    const data = await this.employees.findOne(pinfl);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateEmployeeDto) {
    const data = await this.employees.create(dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':pinfl')
  async update(@Param('pinfl') pinfl: string, @Body() dto: UpdateEmployeeDto) {
    const data = await this.employees.update(pinfl, dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':pinfl/archive')
  async archive(@Param('pinfl') pinfl: string) {
    const data = await this.employees.archive(pinfl);
    return { data };
  }
}
