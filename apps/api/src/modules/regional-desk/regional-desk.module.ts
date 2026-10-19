import { Module } from '@nestjs/common';
import { IncomesModule } from '../incomes/incomes.module';
import { PayrollModule } from '../payroll/payroll.module';
import { RegionalDataModule } from '../regional-data/regional-data.module';
import { RegionalDeskController } from './regional-desk.controller';
import { RegionalDeskService } from './regional-desk.service';

/** Hududchi: hududlar daromadi, ish haqi va xarajatlari */
@Module({
  imports: [IncomesModule, PayrollModule, RegionalDataModule],
  controllers: [RegionalDeskController],
  providers: [RegionalDeskService],
})
export class RegionalDeskModule {}