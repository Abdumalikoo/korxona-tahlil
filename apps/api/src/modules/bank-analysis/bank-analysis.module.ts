import { Module } from '@nestjs/common';
import { BankAnalysisController } from './bank-analysis.controller';
import { BankAnalysisService } from './bank-analysis.service';

/** Xarajatlar › Bank ko'chirmasi — tahlil (xarajat va daromadga yozilmaydi) */
@Module({
  controllers: [BankAnalysisController],
  providers: [BankAnalysisService],
  exports: [BankAnalysisService],
})
export class BankAnalysisModule {}
