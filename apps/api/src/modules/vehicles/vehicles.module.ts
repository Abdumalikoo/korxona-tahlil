import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesDemo } from './vehicles.demo';
import { VehicleFuelImportService } from './vehicles.fuel-import';
import { VehicleQuarterlyService } from './vehicles.quarterly';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesDemo, VehicleFuelImportService, VehicleQuarterlyService],
  exports: [VehiclesService],
})
export class VehiclesModule {}