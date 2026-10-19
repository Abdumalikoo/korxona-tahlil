import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

/** Topshiriqlar va Telegram orqali avtomatik yetkazish */
@Module({
  controllers: [TelegramController, TasksController],
  providers: [TelegramService, TasksService],
  exports: [TelegramService, TasksService],
})
export class TelegramModule {}