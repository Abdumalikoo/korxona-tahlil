import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { SalaryCompositionController } from './salary-composition.controller';
import { SalaryCompositionService } from './salary-composition.service';
import { SalaryStructureService } from './salary-composition.structure';

@Module({
  imports: [PayrollModule],
  controllers: [SalaryCompositionController],
  providers: [SalaryCompositionService, SalaryStructureService],
  exports: [SalaryCompositionService, SalaryStructureService],
})
export class SalaryCompositionModule {}