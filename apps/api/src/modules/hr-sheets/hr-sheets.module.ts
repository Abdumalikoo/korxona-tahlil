import { Module } from '@nestjs/common';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { HrSheetsController } from './hr-sheets.controller';
import { HrSheetsService } from './hr-sheets.service';

/** Xodimlar ma'lumotnomalari (10, 16, 37, 51-jadval) va «Miya» — PINFL bo'yicha xodim kartasi */
@Module({
  imports: [UnitPayrollModule],
  controllers: [HrSheetsController],
  providers: [HrSheetsService],
  exports: [HrSheetsService],
})
export class HrSheetsModule {}