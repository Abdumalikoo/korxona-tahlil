import { Module } from "@nestjs/common";
import { ExpensesService } from "./expenses.service";
import { ExpensesExportService } from "./expenses-export.service";
import { ExpensesController } from "./expenses.controller";
import { SimpleImportService } from "./simple-import.service";
import { SimpleImportController } from "./simple-import.controller";

@Module({
  controllers: [ExpensesController, SimpleImportController],
  providers: [ExpensesService, ExpensesExportService, SimpleImportService],
  exports: [ExpensesService],
})
export class ExpensesModule {}