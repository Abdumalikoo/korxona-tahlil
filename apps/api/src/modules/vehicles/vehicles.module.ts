import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesDemo } from './vehicles.demo';
import { VehicleFuelImportService } from './vehicles.fuel-import';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesDemo, VehicleFuelImportService],
  exports: [VehiclesService],
})
export class VehiclesModule {}