import { Module } from '@nestjs/common';
import { ReactionsModule } from '../reactions/reactions.module';
import { StructureModule } from '../structure/structure.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

/** Avtomatik ogohlantirishlar: muhokama talab qiladigan holatlar */
@Module({
  imports: [ReactionsModule, StructureModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}