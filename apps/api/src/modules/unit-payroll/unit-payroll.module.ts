import { Module } from '@nestjs/common';
import { UnitPayrollController } from './unit-payroll.controller';
import { UnitPayrollService } from './unit-payroll.service';

/** Yo'nalish ish haqi (Tax free …): alohida shablon, xodimlar ro'yxati va vedomost */
@Module({
  controllers: [UnitPayrollController],
  providers: [UnitPayrollService],
  exports: [UnitPayrollService],
})
export class UnitPayrollModule {}