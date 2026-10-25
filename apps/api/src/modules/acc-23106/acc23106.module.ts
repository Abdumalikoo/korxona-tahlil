import { Module } from '@nestjs/common';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { Acc23106Controller } from './acc23106.controller';
import { Acc23106SafarService } from './acc23106.safar.service';
import { Acc23106Service } from './acc23106.service';

/** Xarajatlar › 23106 — xodimlarga to'lovlar hisob raqami ko'chirmasi (nazorat) */
@Module({
  imports: [UnitPayrollModule],
  controllers: [Acc23106Controller],
  providers: [Acc23106Service, Acc23106SafarService],
})
export class Acc23106Module {}