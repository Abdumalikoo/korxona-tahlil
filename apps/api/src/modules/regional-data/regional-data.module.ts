import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { CatalogService } from './catalog.service';
import { PeriodCloseService } from './period-close.service';
import { QualityService } from './quality.service';
import { RegionalDataController } from './regional-data.controller';
import { StaffingService } from './staffing.service';

/** Hududchi: tahlil uchun ma'lumot asosi (1-bosqich) */
@Module({
  controllers: [RegionalDataController],
  providers: [QualityService, PeriodCloseService, CatalogService, StaffingService, BudgetService],
  exports: [PeriodCloseService, QualityService, CatalogService, StaffingService, BudgetService],
})
export class RegionalDataModule {}