import { Global, Module } from '@nestjs/common';
import { TaxesController } from './taxes.controller';
import { TaxesService } from './taxes.service';

/** Global — ish haqi o'zgarganda avtomatik soliqlar (PayrollService) yangilanadi */
@Global()
@Module({
  controllers: [TaxesController],
  providers: [TaxesService],
  exports: [TaxesService],
})
export class TaxesModule {}