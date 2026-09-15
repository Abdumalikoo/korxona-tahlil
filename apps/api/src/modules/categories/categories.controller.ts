import {
    Body,
    Controller,
    DefaultValuePipe,
    Get,
    Param,
    ParseBoolPipe,
    Patch,
    Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { CategoriesService } from './categories.service';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

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


  @Roles(UserRole.ADMIN)
  @Patch(':code')
  async update(@Param('code') code: string, @Body() dto: UpdateCategoryDto) {
    const data = await this.categories.update(code, dto);
    return { data };
  }
}
