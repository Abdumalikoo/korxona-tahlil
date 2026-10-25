import { Module } from '@nestjs/common';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { PayrollSolishtirmaController } from './payroll-solishtirma.controller';
import { PayrollSolishtirmaService } from './payroll-solishtirma.service';

/** Xarajatlar › Ish haqi solishtirma: FOT − ushlanmalar = 23106 (nazorat, hech narsa yozilmaydi) */
@Module({
  imports: [UnitPayrollModule],
  controllers: [PayrollSolishtirmaController],
  providers: [PayrollSolishtirmaService],
})
export class PayrollSolishtirmaModule {}
