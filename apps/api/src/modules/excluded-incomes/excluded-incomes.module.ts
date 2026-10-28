import { Module } from '@nestjs/common';
import { ExcludedIncomesController } from './excluded-incomes.controller';
import { ExcludedIncomesService } from './excluded-incomes.service';

/** Hisobga olinmaydigan tushumlar (depozit, ustav fondi) — daromadga qo'shilmaydi */
@Module({
  controllers: [ExcludedIncomesController],
  providers: [ExcludedIncomesService],
})
export class ExcludedIncomesModule {}
