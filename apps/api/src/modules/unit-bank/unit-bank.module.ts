import { Module } from '@nestjs/common';
import { UnitBankController } from './unit-bank.controller';
import { UnitBankService } from './unit-bank.service';

/** Yo'nalish (Tax free …) bank xarajatlari — bank ko'chirmasi shaklidagi fayldan */
@Module({
  controllers: [UnitBankController],
  providers: [UnitBankService],
  exports: [UnitBankService],
})
export class UnitBankModule {}