import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

/** Xavfsizlik holati va kuzatuvchi huquqlari (guard va interceptor app.module'da — tartib muhim) */
@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}