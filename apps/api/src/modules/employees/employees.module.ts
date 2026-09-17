import { Module } from "@nestjs/common";
import { EmployeesService } from "./employees.service";
import { EmployeesExportService } from "./employees-export.service";
import { EmployeesController } from "./employees.controller";

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesExportService],
  exports: [EmployeesService],
})
export class EmployeesModule {}