import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupModule } from './modules/backup/backup.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { IncomesModule } from './modules/incomes/incomes.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RegionsModule } from './modules/regions/regions.module';
import { ResultsModule } from './modules/results/results.module';
import { SalaryCompositionModule } from './modules/salary-composition/salary-composition.module';
import { EmployeeTransfersModule } from './modules/employee-transfers/employee-transfers.module';
import { LeasesModule } from './modules/leases/leases.module';
import { InternetModule } from './modules/internet/internet.module';
import { BplanModule } from './modules/bplan/bplan.module';
import { SectionsModule } from './modules/sections/sections.module';
import { ModelingModule } from './modules/modeling/modeling.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { StructureModule } from './modules/structure/structure.module';
import { ReportsModule } from './modules/reports/reports.module';
import { EconModule } from './modules/econ/econ.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { SearchModule } from './modules/search/search.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ViewModeModule } from './modules/view-mode/view-mode.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { UsersModule } from './modules/users/users.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { RolesModule } from './modules/roles/roles.module';
import { RegionalDataModule } from './modules/regional-data/regional-data.module';
import { RegionalEconModule } from './modules/regional-econ/regional-econ.module';
import { RegionalDeskModule } from './modules/regional-desk/regional-desk.module';
import { CashbookModule } from './modules/cashbook/cashbook.module';
import { RateLimitGuard } from './common/security/rate-limit';
import { HealthModule } from './modules/health/health.module';
import { ExpensePolicyModule } from './modules/expense-policy/expense-policy.module';
import { BulkDeleteModule } from './modules/bulk-delete/bulk-delete.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { EntriesModule } from './modules/entries/entries.module';
import { AccessGuard } from './common/guards/access.guard';

@Module({
  imports: [
    UsersModule,
    TelegramModule,
    RolesModule,
    RegionalDataModule,
    RegionalEconModule,
    RegionalDeskModule,
    CashbookModule,
    HealthModule,
    ExpensePolicyModule,
    BulkDeleteModule,
    PurchasesModule,
    EntriesModule,
    WarehouseModule,
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
    SalaryCompositionModule,
    EmployeeTransfersModule,
    LeasesModule,
    InternetModule,
    BplanModule,
    SectionsModule,
    ModelingModule,
    VehiclesModule,
    StructureModule,
    ReportsModule,
    EconModule,
    ReactionsModule,
    SearchModule,
    AlertsModule,
    ViewModeModule,
    IntegrityModule,
    BackupModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Ishchi rollar (Omborchi …) — faqat o'z bo'limlari
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}