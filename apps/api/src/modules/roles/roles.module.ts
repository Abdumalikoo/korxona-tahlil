import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** Rollar: nomlari (administrator qo'yadi) va rol dashbordi */
@Module({
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}