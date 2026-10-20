import { Module } from '@nestjs/common';
import { WarehouseActs } from './warehouse.acts';
import { WarehouseCounts } from './warehouse.counts';
import { WarehouseDemo } from './warehouse.demo';
import { WarehousePostal } from './warehouse.postal';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { WarehouseTemplates } from './warehouse.template';
import { WarehouseSigns } from './warehouse.sign';
import { PublicActsController, WarehouseSignController } from './warehouse.sign.controller';
import { TelegramModule } from '../telegram/telegram.module';

/** Ombor: TMZ, asosiy vositalar, kirim-chiqim hujjatlari, inventarizatsiya va dalolatnomalar */
@Module({
  imports: [TelegramModule],
  controllers: [WarehouseController, WarehouseSignController, PublicActsController],
  providers: [WarehouseService, WarehouseCounts, WarehousePostal, WarehouseActs, WarehouseDemo, WarehouseTemplates, WarehouseSigns],
  exports: [WarehouseService],
})
export class WarehouseModule {}