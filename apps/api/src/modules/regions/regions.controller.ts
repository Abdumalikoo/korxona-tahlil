import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { RegionsService } from './regions.service';

@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  async findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.regions.findAll(includeInactive);
    return { data };
  }

  /** Viloyatlar tumanlari bilan - tanlagich uchun */
  @Get('tree')
  async tree(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.regions.findAllWithDistricts(includeInactive);
    return { data };
  }

  /** Barcha tumanlar - qidiruv bilan */
  @Get('districts')
  async allDistricts(@Query('search') search?: string) {
    const data = await this.regions.findAllDistricts(search);
    return { data };
  }

  @Get(':code')
  async findOne(@Param('code', ParseIntPipe) code: number) {
    const data = await this.regions.findOne(code);
    return { data };
  }

  @Get(':code/districts')
  async districts(
    @Param('code', ParseIntPipe) code: number,
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    const data = await this.regions.findDistricts(code, includeInactive);
    return { data };
  }
}
