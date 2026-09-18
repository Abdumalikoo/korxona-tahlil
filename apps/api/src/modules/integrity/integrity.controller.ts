import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { IntegrityService } from './integrity.service';

@Controller('integrity')
export class IntegrityController {
  constructor(private readonly integrity: IntegrityService) {}

  /** Malumot yaxlitligini tekshiradi */
  @Roles(UserRole.ADMIN)
  @Get('check')
  async check() {
    const data = await this.integrity.check();
    return { data };
  }

  /** Muammoni tuzatadi */
  @Roles(UserRole.ADMIN)
  @Post('fix/:code')
  @HttpCode(HttpStatus.OK)
  async fix(@Param('code') code: string) {
    const data = await this.integrity.fix(code);
    return { data };
  }
}
