import { Global, Module } from '@nestjs/common';
import { FixedAssetAdoptService } from './fixed-assets.adopt';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetImportService } from './fixed-assets.import';
import { FixedAssetReportService } from './fixed-assets.report';
import { FixedAssetsService } from './fixed-assets.service';
import { XaridController } from './xarid.controller';
import { XaridService } from './xarid.service';

/** Global — Xarajatlar (kiritilganda balansga olish) va Markaz tahlili foydalanadi */
@Global()
@Module({
  controllers: [XaridController, FixedAssetsController],
  providers: [FixedAssetsService, FixedAssetImportService, FixedAssetReportService, FixedAssetAdoptService, XaridService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}