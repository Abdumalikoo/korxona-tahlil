import { Module } from "@nestjs/common";
import { EmployeesService } from "./employees.service";
import { EmployeesExportService } from "./employees-export.service";
import { EmployeesController } from "./employees.controller";
import { EmployeePlacementsService } from "./employee-placements.service";

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesExportService, EmployeePlacementsService],
  exports: [EmployeesService],
})
export class EmployeesModule {}