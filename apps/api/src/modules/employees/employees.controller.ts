import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Delete,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { EmployeesService } from './employees.service';
import { EmployeesExportService } from './employees-export.service';
import { EmployeePlacementsService } from './employee-placements.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { CurrentUser, Personal, Roles } from '../../common/decorators';

@Personal()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly exportService: EmployeesExportService,
    private readonly placementsService: EmployeePlacementsService,
  ) {}

  // --------- Statistika (":pinfl" dan oldin) ---------

  @Personal(false)
  @Get('stats')
  async stats() {
    const data = await this.employees.stats();
    return { data };
  }

  /** Excel eksport */
  @Get('export')
  async exportExcel(@Query() query: QueryEmployeeDto, @Res() response: Response) {
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

  @Get(':pinfl/usage')
  async usage(@Param('pinfl') pinfl: string) {
    const data = await this.employees.usage(pinfl);
    return { data };
  }

  @Personal(false)
  @Get('by-region')
  async byRegion() {
    const data = await this.employees.byRegion();
    return { data };
  }

  @Personal(false)
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

  // --------- Joylashuv davrlari: «shu oydan shu oygacha shu joyda, shu lavozimda» ---------

  @Get(':pinfl/placements')
  async placements(@Param('pinfl') pinfl: string) {
    return { data: await this.placementsService.list(pinfl) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':pinfl/placements')
  async addPlacement(@Param('pinfl') pinfl: string, @Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.placementsService.add(pinfl, body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':pinfl/placements/:id')
  @HttpCode(HttpStatus.OK)
  async removePlacement(@Param('pinfl') pinfl: string, @Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.placementsService.remove(pinfl, id, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateEmployeeDto) {
    const data = await this.employees.create(dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':pinfl')
  async update(
    @Param('pinfl') pinfl: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.employees.update(pinfl, dto, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':pinfl')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('pinfl') pinfl: string) {
    const data = await this.employees.remove(pinfl);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':pinfl/archive')
  async archive(@Param('pinfl') pinfl: string) {
    const data = await this.employees.archive(pinfl);
    return { data };
  }
}