import { Module } from '@nestjs/common';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { BankAnalysisModule } from '../bank-analysis/bank-analysis.module';
import { CashbookModule } from '../cashbook/cashbook.module';
import { PayrollModule } from '../payroll/payroll.module';
import { Hisob3802Controller } from './hisob-3802.controller';
import { Hisob3802Service } from './hisob-3802.service';
import { Nazorat3802Controller } from './nazorat-3802.controller';
import { Nazorat3802Service } from './nazorat-3802.service';
import { QomitaStatementController } from './qomita-statement.controller';
import { QomitaStatementService } from './qomita-statement.service';
import { QomitaController } from './qomita.controller';
import { QomitaService } from './qomita.service';
import { Shtat3802Controller } from './shtat-3802.controller';
import { Shtat3802Service } from './shtat-3802.service';
import { Vedomost3802Controller } from './vedomost-3802.controller';
import { Vedomost3802Service } from './vedomost-3802.service';

/** Qo'mita mablag'lari: ajratmalar (daromad) va ular qoplaydigan xarajatlar; 3802 — shtat jadvali va oylik vedomost */
@Module({
  // Kassa (Markaz daromadi): Qo'mita qatorlari Qo'mita mablag'lari bilan bitta pul — yozuv o'zgarsa qayta hisoblanadi
  imports: [PayrollModule, BankAnalysisModule, CashbookModule, UnitPayrollModule],
  controllers: [QomitaController, QomitaStatementController, Shtat3802Controller, Vedomost3802Controller, Nazorat3802Controller, Hisob3802Controller],
  providers: [QomitaService, QomitaStatementService, Shtat3802Service, Vedomost3802Service, Nazorat3802Service, Hisob3802Service],
  // Hisobotlar (Bo'limlar bo'yicha) — Qo'mita qoplashi
  exports: [Nazorat3802Service],
})
export class QomitaModule {}
