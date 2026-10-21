import { Module } from '@nestjs/common';
import { ModelingModule } from '../modeling/modeling.module';
import { HpController } from './hp.controller';
import { HpDataService } from './hp.data';
import { HpExportService } from './hp.export';
import { HpImportService } from './hp.import.service';
import { HpService } from './hp.service';

/** Hudud uchun reja: 39 xizmat bo'yicha prognoz va xodimlar rejasi (hisob — apps/analytics Python xizmatida) */
@Module({
  imports: [ModelingModule],
  controllers: [HpController],
  providers: [HpDataService, HpImportService, HpService, HpExportService],
})
export class HududRejaModule {}