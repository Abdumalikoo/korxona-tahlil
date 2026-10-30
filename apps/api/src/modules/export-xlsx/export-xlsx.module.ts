import { Module } from '@nestjs/common';
import { ExportXlsxController } from './export-xlsx.controller';
import { ExportXlsxService } from './export-xlsx.service';

/** Excel eksport — hamma sahifa jadvali tushunarli .xlsx faylga */
@Module({
  controllers: [ExportXlsxController],
  providers: [ExportXlsxService],
})
export class ExportXlsxModule {}
