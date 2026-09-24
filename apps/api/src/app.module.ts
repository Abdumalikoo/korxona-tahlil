import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { IncomesModule } from './modules/incomes/incomes.module';
import { RegionsModule } from './modules/regions/regions.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { AuditModule } from './modules/audit/audit.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { BackupModule } from './modules/backup/backup.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ResultsModule } from './modules/results/results.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      cache: true,
    }),
    PrismaModule,
    AuthModule,
    DepartmentsModule,
    CategoriesModule,
    ExpensesModule,
    IncomesModule,
    RegionsModule,
    EmployeesModule,
    PayrollModule,
    ScheduleModule.forRoot(),
    DashboardModule,
    CleanupModule,
    AuditModule,
    ResultsModule,
    IntegrityModule,
    BackupModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
