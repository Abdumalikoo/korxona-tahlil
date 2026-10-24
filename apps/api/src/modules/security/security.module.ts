import { Module } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { BulkDeleteModule } from '../bulk-delete/bulk-delete.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

/** Xavfsizlik holati va kuzatuvchi huquqlari (guard va interceptor app.module'da — tartib muhim) */
@Module({
  imports: [BackupModule, BulkDeleteModule],
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}