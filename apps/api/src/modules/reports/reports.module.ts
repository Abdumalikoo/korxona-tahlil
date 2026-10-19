import { Module } from '@nestjs/common';
import { EconModule } from '../econ/econ.module';
import { ReactionsModule } from '../reactions/reactions.module';
import { SectionsModule } from '../sections/sections.module';
import { StructureModule } from '../structure/structure.module';
import { ReconcileService } from './reconcile.service';
import { AssetsReport } from './report.assets';
import { ControlsReport } from './report.controls';
import { ExecutiveReport } from './report.executive';
import { ExpensesReport } from './report.expenses';
import { IncomesReport } from './report.incomes';
import { ModelsReport } from './report.models';
import { PayrollReport } from './report.payroll';
import { FinancialReport } from './report.financial';
import { PassportReport } from './report.passport';
import { ReactionsSummaryReport } from './report.reactions';
import { RegionsReport } from './report.regions';
import { ReportsController } from './reports.controller';
import { ReportData } from './reports.data';
import { ReportsService } from './reports.service';

/** Hisobotlar markazi */
@Module({
  imports: [EconModule, ReactionsModule, StructureModule, SectionsModule],
  controllers: [ReportsController],
  providers: [ReportData, FinancialReport, ExecutiveReport, RegionsReport, PassportReport, ExpensesReport, IncomesReport, PayrollReport, AssetsReport, ReactionsSummaryReport, ControlsReport, ModelsReport, ReconcileService, ReportsService],
  exports: [ReportData, ReportsService],
})
export class ReportsModule {}