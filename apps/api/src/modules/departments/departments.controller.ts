import {
    Body,
    Controller,
    DefaultValuePipe,
    Get,
    Param,
    ParseBoolPipe,
    Patch,
    Post,
    Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  async findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.departments.findAll(includeInactive);
    return { data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {

    const data = await this.departments.findOne(id);
    return { data };
  }

  @Get(':id/usage')
  async usage(@Param('id') id: string) {
    const data = await this.departments.getUsage(id);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() dto: CreateDepartmentDto) {
    const data = await this.departments.create(dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    const data = await this.departments.update(id, dto);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/archive')
  async archive(@Param('id') id: string) {
    const data = await this.departments.archive(id);
    return { data };
  }
}
