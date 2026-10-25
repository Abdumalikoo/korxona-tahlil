import { Module } from '@nestjs/common';
import { SalaryCompositionModule } from '../salary-composition/salary-composition.module';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { PayrollSolishtirmaController } from './payroll-solishtirma.controller';
import { PayrollSolishtirmaService } from './payroll-solishtirma.service';

/** Xarajatlar › Ish haqi solishtirma: FOT − ushlanmalar = 23106 (nazorat, hech narsa yozilmaydi) */
@Module({
  // SalaryCompositionModule — Markaz tablosida tarkib farqini komponentga yo'naltirish (uchlik nazorat xizmati)
  imports: [UnitPayrollModule, SalaryCompositionModule],
  controllers: [PayrollSolishtirmaController],
  providers: [PayrollSolishtirmaService],
})
export class PayrollSolishtirmaModule {}
