import { Module } from '@nestjs/common';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';

/** KPI baholash: bo'lim rahbarlari va yig'ma KPI */
@Module({
  controllers: [KpiController],
  providers: [KpiService],
})
export class KpiModule {}
