import { Module } from '@nestjs/common';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';

/** Bosh sahifa › Daromad / Xarajat / Tahlil */
@Module({
  controllers: [ExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}