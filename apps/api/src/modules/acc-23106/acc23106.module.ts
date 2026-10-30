import { Module } from '@nestjs/common';
import { PayrollModule } from '../payroll/payroll.module';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { Acc23106BayramService } from './acc23106.bayram.service';
import { Acc23106Controller } from './acc23106.controller';
import { Acc23106SafarService } from './acc23106.safar.service';
import { Acc23106Service } from './acc23106.service';

/** Xarajatlar › 23106 — xodimlarga to'lovlar hisob raqami ko'chirmasi (nazorat) */
@Module({
  imports: [UnitPayrollModule, PayrollModule],
  controllers: [Acc23106Controller],
  providers: [Acc23106Service, Acc23106SafarService, Acc23106BayramService],
})
export class Acc23106Module {}
