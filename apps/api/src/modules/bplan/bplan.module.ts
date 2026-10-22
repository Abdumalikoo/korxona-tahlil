import { Module } from '@nestjs/common';
import { BplanController } from './bplan.controller';
import { BplanService } from './bplan.service';

/** Hisobotlar › Choraklik ijro (biznes-reja) */
@Module({
  controllers: [BplanController],
  providers: [BplanService],
  // «Umumiy hisobot» reja–fakt uchun (Hisobotlar markazi)
  exports: [BplanService],
})
export class BplanModule {}