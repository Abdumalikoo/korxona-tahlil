import { Module } from '@nestjs/common';
import { EconController } from './econ.controller';
import { EconData } from './econ.data';
import { EfficiencyService } from './econ.efficiency';
import { FactorsService } from './econ.factors';
import { EconReportService } from './econ.report';
import { ScenarioService } from './econ.scenario';
import { EconService } from './econ.service';

/** Katta modellar (ekonometrika va prognoz) */
@Module({
  controllers: [EconController],
  providers: [EconData, EconService, FactorsService, EfficiencyService, ScenarioService, EconReportService],
  exports: [EconData, EconService, FactorsService, EfficiencyService, ScenarioService],
})
export class EconModule {}