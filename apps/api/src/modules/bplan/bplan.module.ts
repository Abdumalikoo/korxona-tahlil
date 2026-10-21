import { Module } from '@nestjs/common';
import { BplanController } from './bplan.controller';
import { BplanService } from './bplan.service';

/** Hisobotlar › Choraklik ijro (biznes-reja) */
@Module({
  controllers: [BplanController],
  providers: [BplanService],
})
export class BplanModule {}