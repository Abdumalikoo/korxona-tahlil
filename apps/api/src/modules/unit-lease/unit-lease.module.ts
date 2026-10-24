import { Module } from '@nestjs/common';
import { UnitLeaseController } from './unit-lease.controller';
import { UnitLeaseService } from './unit-lease.service';

/** Yo'nalish (Tax free …) ijara va kommunal to'lovlari — filiallar kesimida, oylar oralig'i bilan */
@Module({
  controllers: [UnitLeaseController],
  providers: [UnitLeaseService],
  exports: [UnitLeaseService],
})
export class UnitLeaseModule {}