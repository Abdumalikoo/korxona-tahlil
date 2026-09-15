import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Ma\u2019lumotlar bazasiga ulanildi');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Ma\u2019lumotlar bazasi ulanishi yopildi');
  }

  /**
   * Yumshoq o'chirilgan yozuvlarni chiqarib tashlash uchun standart filtr.
   * Har bir so'rovda `where: { ...notDeleted }` sifatida ishlatiladi.
   */
  readonly notDeleted = { deletedAt: null };
}
