import { Module } from '@nestjs/common';
import { CenterService } from './center.service';
import { ChangesService } from './changes.service';
import { DistrictsController } from './districts.controller';
import { DistrictsService } from './districts.service';
import { RegionsController } from './regions.controller';
import { RegionsService } from './regions.service';
import { SegmentsService } from './segments.service';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';
import { UnassignedService } from './unassigned.service';
import { VehicleCostsService } from './vehicle-costs.service';
import { SafarCostsService } from './safar-costs.service';
import { PartDetailService } from './part-detail.service';

@Module({
  // RegionsController va DistrictsController birinchi: "structure/regions" va "structure/drill"
  // yo'llari ":kind/tree" dan oldin tekshiriladi
  controllers: [RegionsController, DistrictsController, StructureController],
  providers: [StructureService, RegionsService, DistrictsService, CenterService, ChangesService, UnassignedService, SegmentsService, VehicleCostsService, SafarCostsService, PartDetailService],
  // Hisobotlar bo'limidagi raqamlar tekshiruvi uchun
  exports: [StructureService, RegionsService, DistrictsService, CenterService, ChangesService, UnassignedService, SegmentsService],
})
export class StructureModule {}