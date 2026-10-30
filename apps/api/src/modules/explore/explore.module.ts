import { Module } from '@nestjs/common';
import { ExploreController } from './explore.controller';
import { ExploreService } from './explore.service';
import { QomitaModule } from '../qomita/qomita.module';

/** Bosh sahifa › Daromad / Xarajat / Tahlil */
@Module({
  imports: [QomitaModule],
  controllers: [ExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}