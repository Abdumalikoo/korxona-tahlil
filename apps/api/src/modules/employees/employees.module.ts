import { Module } from "@nestjs/common";
import { EmployeesService } from "./employees.service";
import { EmployeesExportService } from "./employees-export.service";
import { EmployeesController } from "./employees.controller";
import { EmployeePlacementsService } from "./employee-placements.service";
import { EmployeeChainService } from "./employee-chain.service";

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesExportService, EmployeePlacementsService, EmployeeChainService],
  exports: [EmployeesService, EmployeeChainService],
})
export class EmployeesModule {}