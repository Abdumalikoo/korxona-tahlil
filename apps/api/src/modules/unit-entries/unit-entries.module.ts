import { Module } from '@nestjs/common';
import { UnitEntriesController } from './unit-entries.controller';
import { UnitEntriesService } from './unit-entries.service';

/** Yo'nalish xarajatlari (Tax free …): asosiy vositalar, reklama, boshqa — qo'lda kiritish jadvali */
@Module({
  controllers: [UnitEntriesController],
  providers: [UnitEntriesService],
  exports: [UnitEntriesService],
})
export class UnitEntriesModule {}