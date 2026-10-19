import { Module } from '@nestjs/common';
import { ViewModeController } from './view-mode.controller';
import { ViewModeService } from './view-mode.service';

/** Ko'rinish rejimi (qisqa / to'liq) — Sozlamalarda va yuqori panelda */
@Module({
  controllers: [ViewModeController],
  providers: [ViewModeService],
  exports: [ViewModeService],
})
export class ViewModeModule {}