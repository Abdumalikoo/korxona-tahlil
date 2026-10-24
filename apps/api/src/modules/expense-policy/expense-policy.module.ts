import { Module } from '@nestjs/common';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { PayrollModule } from '../payroll/payroll.module';
import { TaxesModule } from '../taxes/taxes.module';
import { ExpensePolicyController } from './expense-policy.controller';
import { ExpensePolicyService } from './expense-policy.service';
import { UnitPolicyService } from './unit-policy.service';

@Module({
  imports: [PayrollModule, FixedAssetsModule, TaxesModule],
  controllers: [ExpensePolicyController],
  providers: [ExpensePolicyService, UnitPolicyService],
  exports: [ExpensePolicyService, UnitPolicyService],
})
export class ExpensePolicyModule {}