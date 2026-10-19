import { Module } from '@nestjs/common';
import { ModelingController } from './modeling.controller';
import { ModelingService } from './modeling.service';

@Module({
  controllers: [ModelingController],
  providers: [ModelingService],
  exports: [ModelingService],
})
export class ModelingModule {}