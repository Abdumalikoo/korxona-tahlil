import { Global, Module } from '@nestjs/common';
import { SourceArchiveController } from './source-archive.controller';
import { SourceArchiveService } from './source-archive.service';

/** Yuklangan manba fayllar arxivi — hamma yuklash modullari ishlatadi */
@Global()
@Module({
  controllers: [SourceArchiveController],
  providers: [SourceArchiveService],
  exports: [SourceArchiveService],
})
export class SourceArchiveModule {}
