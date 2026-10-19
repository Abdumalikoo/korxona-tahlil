import { Module } from '@nestjs/common';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

/** Xarid: yetkazuvchilar, arizalar, birja/oddiy xaridlar, to'lovlar va omborga qabul */
@Module({
  imports: [WarehouseModule],
  controllers: [PurchasesController, ReceiptsController],
  providers: [PurchasesService, ReceiptsService],
  exports: [PurchasesService, ReceiptsService],
})
export class PurchasesModule {}