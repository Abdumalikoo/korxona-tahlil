import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Server tirikmi va baza javob beryaptimi — nginx/monitoring uchun: GET /api/health */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; uptimeSec: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new HttpException({ status: 'down' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }
}