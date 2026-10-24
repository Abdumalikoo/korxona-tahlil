import { Module } from '@nestjs/common';
import { HrSheetsModule } from '../hr-sheets/hr-sheets.module';
import { UnitPayrollModule } from '../unit-payroll/unit-payroll.module';
import { SourceChatController } from './chat.controller';
import { SourceChatService } from './chat.service';

/** Chat › Manba chati — savolga tizim manbalaridan javob (xodimlar, ish haqi, xarajat, daromad, natija) */
@Module({
  imports: [HrSheetsModule, UnitPayrollModule],
  controllers: [SourceChatController],
  providers: [SourceChatService],
})
export class SourceChatModule {}