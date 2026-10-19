import { Module } from '@nestjs/common';
import { RegionalDataModule } from '../regional-data/regional-data.module';
import { DashboardService } from './dashboard.service';
import { RegionalDemo } from './regional.demo';
import { RegionalEconController } from './regional-econ.controller';
import { ForecastService } from './forecast.service';
import { KpiService } from './kpi.service';
import { PotentialService } from './potential.service';
import { RegionalEconService } from './regional-econ.service';

/** Katta modellar: hudud natijasi (G), Markaz xarajatini taqsimlash (F), hudud prognozi (3), salohiyat va KPI (4), panel va stsenariylar (5) */
@Module({
  imports: [RegionalDataModule],
  controllers: [RegionalEconController],
  providers: [RegionalEconService, ForecastService, PotentialService, KpiService, DashboardService, RegionalDemo],
  exports: [RegionalEconService, ForecastService, PotentialService, KpiService, DashboardService],
})
export class RegionalEconModule {}