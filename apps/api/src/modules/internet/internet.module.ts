import { Module } from '@nestjs/common';
import { InternetController } from './internet.controller';
import { InternetService } from './internet.service';

@Module({
  controllers: [InternetController],
  providers: [InternetService],
})
export class InternetModule {}