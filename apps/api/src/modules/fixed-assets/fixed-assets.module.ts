import { Global, Module } from '@nestjs/common';
import { FixedAssetAdoptService } from './fixed-assets.adopt';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetImportService } from './fixed-assets.import';
import { FixedAssetReportService } from './fixed-assets.report';
import { FixedAssetsService } from './fixed-assets.service';

/** Global — Xarajatlar (kiritilganda balansga olish) va Markaz tahlili foydalanadi */
@Global()
@Module({
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService, FixedAssetImportService, FixedAssetReportService, FixedAssetAdoptService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}