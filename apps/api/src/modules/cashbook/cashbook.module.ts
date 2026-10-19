import { Module } from '@nestjs/common';
import { CashbookController } from './cashbook.controller';
import { CashbookService } from './cashbook.service';
import { CenterIncomeController } from './center-income.controller';
import { CenterIncomeService } from './center-income.service';

/** Buxgalteriya: kunlik tushum va qoldiq (Buxgalter roli); Markaz daromadlari — shundan oylik daromad */
@Module({
  controllers: [CashbookController, CenterIncomeController],
  providers: [CashbookService, CenterIncomeService],
  exports: [CashbookService, CenterIncomeService],
})
export class CashbookModule {}