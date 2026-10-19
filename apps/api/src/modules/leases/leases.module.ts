import { Module } from '@nestjs/common';
import { LeasesController } from './leases.controller';
import { LeaseImportService } from './leases.import';
import { LeaseMonthsService } from './leases.months';
import { LeasesService } from './leases.service';

@Module({
  controllers: [LeasesController],
  providers: [LeasesService, LeaseMonthsService, LeaseImportService],
  exports: [LeasesService, LeaseMonthsService],
})
export class LeasesModule {}
