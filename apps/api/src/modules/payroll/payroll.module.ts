import { Module } from "@nestjs/common";
import { TaxesModule } from "../taxes/taxes.module";
import { UnitPayrollModule } from "../unit-payroll/unit-payroll.module";
import { PayrollPlanController } from "./payroll-plan.controller";
import { PayrollPlanService } from "./payroll-plan.service";
import { PayrollService } from "./payroll.service";
import { PayrollControlService } from "./payroll-control.service";
import { PayrollController } from "./payroll.controller";

@Module({
  // Ish haqidan foizli soliqlar (ijtimoiy soliq) vedomost o'zgarganda qayta hisoblanadi
  imports: [TaxesModule, UnitPayrollModule],
  controllers: [PayrollController, PayrollPlanController],
  providers: [PayrollService, PayrollPlanService, PayrollControlService],
  exports: [PayrollService, PayrollPlanService, PayrollControlService],
})
export class PayrollModule {}