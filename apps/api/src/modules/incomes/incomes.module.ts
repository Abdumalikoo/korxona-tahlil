import { Module } from '@nestjs/common';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { IncomesExportService } from './incomes-export.service';
import { RegionalIncomeService } from './regional-income.service';
import { RegionalIncomeController } from './regional-income.controller';
import { SourceArchiveModule } from '../source-archive/source-archive.module';

@Module({
  imports: [SourceArchiveModule],
  controllers: [IncomesController, RegionalIncomeController],
  providers: [IncomesService, RegionalIncomeService, IncomesExportService],
  exports: [IncomesService, RegionalIncomeService],
})
export class IncomesModule {}
