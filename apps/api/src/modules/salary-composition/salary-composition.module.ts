import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { SalaryCompositionController } from './salary-composition.controller';
import { CompositionReconcileService } from './salary-composition.reconcile';
import { SalaryCompositionService } from './salary-composition.service';
import { SalaryStructureService } from './salary-composition.structure';

@Module({
  // UnitPayrollModule — yo'nalish (Tax free …) tarkibi shu bo'lim ish haqi vedomosti bilan solishtiriladi
  imports: [PayrollModule, UnitPayrollModule],
  controllers: [SalaryCompositionController],
  providers: [SalaryCompositionService, SalaryStructureService, CompositionReconcileService],
  exports: [SalaryCompositionService, SalaryStructureService, CompositionReconcileService],
})
export class SalaryCompositionModule {}