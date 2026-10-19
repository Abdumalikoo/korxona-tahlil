import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller';
import { VehiclesDemo } from './vehicles.demo';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, VehiclesDemo],
  exports: [VehiclesService],
})
export class VehiclesModule {}