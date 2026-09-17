import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService, type AuditAction } from './audit.service';
import { Roles } from '../../common/decorators';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Umumiy ozgarishlar tarixi */
  @Roles(UserRole.ADMIN)
  @Get()
  async findAll(
    @Query('entity') entity?: string,
    @Query('action') action?: AuditAction,
    @Query('userId') userId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    const result = await this.audit.findAll({ entity, action, userId, page, limit });
    return { data: result.items, meta: result.meta };
  }

  /** Bitta yozuvning tarixi */
  @Roles(UserRole.ADMIN)
  @Get(':entity/:entityId')
  async findByEntity(
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
  ) {
    const data = await this.audit.findByEntity(entity, entityId);
    return { data };
  }
}
