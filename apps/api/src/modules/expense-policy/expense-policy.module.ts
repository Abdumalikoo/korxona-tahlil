import { Module } from '@nestjs/common';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { PayrollModule } from '../payroll/payroll.module';
import { TaxesModule } from '../taxes/taxes.module';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { ExpensePolicyController } from './expense-policy.controller';
import { ExpensePolicyService } from './expense-policy.service';
import { UnitPolicyService } from './unit-policy.service';
import { DepPolicyService } from './dep-policy.service';

@Module({
  imports: [PayrollModule, FixedAssetsModule, TaxesModule, UnitPayrollModule],
  controllers: [ExpensePolicyController],
  providers: [ExpensePolicyService, UnitPolicyService, DepPolicyService],
  exports: [ExpensePolicyService, UnitPolicyService],
})
export class ExpensePolicyModule {}