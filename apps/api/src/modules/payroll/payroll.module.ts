import { Module } from "@nestjs/common";
import { TaxesModule } from "../taxes/taxes.module";
import { PayrollService } from "./payroll.service";
import { PayrollController } from "./payroll.controller";

@Module({
  // Ish haqidan foizli soliqlar (ijtimoiy soliq) vedomost o'zgarganda qayta hisoblanadi
  imports: [TaxesModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}