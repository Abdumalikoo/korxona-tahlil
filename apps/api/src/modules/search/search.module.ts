import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Global qidiruv (Ctrl+K) */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}