import { Module } from '@nestjs/common';
import { BankAnalysisController } from './bank-analysis.controller';
import { BankAnalysisService } from './bank-analysis.service';
import { CounterpartyController } from './counterparty.controller';
import { CounterpartyService } from './counterparty.service';
import { InvoiceAnalysisController } from './invoice-analysis.controller';
import { InvoiceAnalysisService } from './invoice-analysis.service';

/** Bank ko'chirmasi, schyot-fakturalar tahlili va kontragentlar «miyasi» (nazorat; xarajat / daromadga faqat tanlab yo'naltirilganda) */
@Module({
  controllers: [BankAnalysisController, InvoiceAnalysisController, CounterpartyController],
  providers: [BankAnalysisService, InvoiceAnalysisService, CounterpartyService],
  exports: [BankAnalysisService, InvoiceAnalysisService, CounterpartyService],
})
export class BankAnalysisModule {}
