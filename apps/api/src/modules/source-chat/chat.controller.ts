import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { SourceChatService } from './chat.service';

/** Chat › Manba chati: /api/source-chat/… — tizimdagi manbalardan javob (faqat administrator) */
@Roles(UserRole.ADMIN)
@Controller('source-chat')
export class SourceChatController {
  constructor(private readonly service: SourceChatService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async ask(@Body() body: { text?: unknown; context?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.ask(body, userId) };
  }

  @Get('history')
  async history(@CurrentUser('id') userId: string) {
    return { data: await this.service.history(userId) };
  }

  @Delete('history')
  async clear(@CurrentUser('id') userId: string) {
    return { data: await this.service.clearHistory(userId) };
  }
}