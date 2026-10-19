import { Module } from '@nestjs/common';
import { CashbookModule } from '../cashbook/cashbook.module';
import { LeasesModule } from '../leases/leases.module';
import { PayrollModule } from '../payroll/payroll.module';
import { SalaryCompositionModule } from '../salary-composition/salary-composition.module';
import { RegionalDataModule } from '../regional-data/regional-data.module';
import { BulkDeleteController } from './bulk-delete.controller';
import { BulkDeleteService } from './bulk-delete.service';

@Module({
  imports: [PayrollModule, RegionalDataModule, LeasesModule, SalaryCompositionModule, CashbookModule],
  controllers: [BulkDeleteController],
  providers: [BulkDeleteService],
})
export class BulkDeleteModule {}