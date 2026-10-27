import { Module } from '@nestjs/common';
import { BankAnalysisModule } from '../bank-analysis/bank-analysis.module';
import { PayrollModule } from '../payroll/payroll.module';
import { QomitaController } from './qomita.controller';
import { QomitaService } from './qomita.service';

/** Qo'mita mablag'lari: ajratmalar (daromad) va ular qoplaydigan xarajatlar */
@Module({
  imports: [PayrollModule, BankAnalysisModule],
  controllers: [QomitaController],
  providers: [QomitaService],
})
export class QomitaModule {}
