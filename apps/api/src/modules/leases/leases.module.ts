import { Module } from '@nestjs/common';
import { LeasesController } from './leases.controller';
import { LeaseImportService } from './leases.import';
import { LeaseMonthsService } from './leases.months';
import { LeasesService } from './leases.service';
import { RegionalRentController } from './regional-rent.controller';
import { RegionalRentService } from './regional-rent.service';

@Module({
  controllers: [RegionalRentController, LeasesController],
  providers: [LeasesService, LeaseMonthsService, LeaseImportService, RegionalRentService],
  exports: [LeasesService, LeaseMonthsService],
})
export class LeasesModule {}
