import { Module } from "@nestjs/common";
import { ExpensesService } from "./expenses.service";
import { ExpensesExportService } from "./expenses-export.service";
import { ExpensesController } from "./expenses.controller";

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpensesExportService],
  exports: [ExpensesService],
})
export class ExpensesModule {}