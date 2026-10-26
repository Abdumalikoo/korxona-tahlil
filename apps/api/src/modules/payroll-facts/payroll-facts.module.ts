import { Global, Module } from '@nestjs/common';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { PayrollFactsService } from './payroll-facts.service';

/** Ish haqi faktlari — xodimning soliq summasi, tarkibi, joyi (hamma sahifa uchun bitta qoida) */
@Global()
@Module({
  imports: [UnitPayrollModule],
  providers: [PayrollFactsService],
  exports: [PayrollFactsService],
})
export class PayrollFactsModule {}
