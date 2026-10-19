import { Module } from '@nestjs/common';
import { WarehouseActs } from './warehouse.acts';
import { WarehouseCounts } from './warehouse.counts';
import { WarehouseDemo } from './warehouse.demo';
import { WarehousePostal } from './warehouse.postal';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { WarehouseTemplates } from './warehouse.template';

/** Ombor: TMZ, asosiy vositalar, kirim-chiqim hujjatlari, inventarizatsiya va dalolatnomalar */
@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService, WarehouseCounts, WarehousePostal, WarehouseActs, WarehouseDemo, WarehouseTemplates],
  exports: [WarehouseService],
})
export class WarehouseModule {}