import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';
import { MetricsService } from './metrics.service';
import { DashboardController } from './dashboard.controller';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, InsightsService, MetricsService],
  exports: [DashboardService],
})
export class DashboardModule {}
