import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { PlanFactController } from './plan-fact.controller';
import { PlanFactService } from './plan-fact.service';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [PayrollModule],
  controllers: [ResultsController, PlanFactController],
  providers: [ResultsService, PlanFactService],
  exports: [ResultsService, PlanFactService],
})
export class ResultsModule {}