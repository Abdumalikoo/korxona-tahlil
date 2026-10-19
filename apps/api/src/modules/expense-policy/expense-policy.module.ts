import { Module } from '@nestjs/common';
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module';
import { PayrollModule } from '../payroll/payroll.module';
import { TaxesModule } from '../taxes/taxes.module';
import { ExpensePolicyController } from './expense-policy.controller';
import { ExpensePolicyService } from './expense-policy.service';

@Module({
  imports: [PayrollModule, FixedAssetsModule, TaxesModule],
  controllers: [ExpensePolicyController],
  providers: [ExpensePolicyService],
  exports: [ExpensePolicyService],
})
export class ExpensePolicyModule {}