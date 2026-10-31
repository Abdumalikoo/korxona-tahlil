import { Module } from '@nestjs/common';
import { CashbookModule } from '../cashbook/cashbook.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { PayrollModule } from '../payroll/payroll.module';
import { CostStructureController } from './cost-structure.controller';
import { CostStructureService } from './cost-structure.service';

/** Moddalar boshqaruvi › Xarajatlar tarkibiy tuzilishi — birlikning daromad va xarajat tomoni, yozuvlarni ko'chirish */
@Module({
  imports: [ExpensesModule, CashbookModule, PayrollModule],
  controllers: [CostStructureController],
  providers: [CostStructureService],
})
export class CostStructureModule {}
