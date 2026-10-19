import { Module } from '@nestjs/common';
import { StructureModule } from '../structure/structure.module';
import { ControlsController } from './controls.controller';
import { ControlsService } from './controls.service';
import { ReactionsReportService } from './reactions-report.service';
import { ReactionsSlidesService } from './reactions-slides.service';
import { ReactionsController } from './reactions.controller';
import { ReactionMetrics } from './reactions.metrics';
import { ReactionsService } from './reactions.service';

/** Munosabat va Nazorat */
@Module({
  // Solishtirma hisobi (viloyat, tuman, Markaz bo'limi) — Munosabatdagi raqamlar u bilan bir xil bo'lsin
  imports: [StructureModule],
  controllers: [ReactionsController, ControlsController],
  providers: [ReactionMetrics, ReactionsService, ControlsService, ReactionsReportService, ReactionsSlidesService],
  exports: [ReactionsService, ControlsService, ReactionMetrics],
})
export class ReactionsModule {}