import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SerializeWritesInterceptor } from './common/interceptors/serialize-writes.interceptor';
import { PersonalDataGuard } from './modules/security/personal-data.guard';
import { PersonalMaskInterceptor } from './modules/security/personal-mask.interceptor';
import { SecurityModule } from './modules/security/security.module';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AccessGuard } from './common/guards/access.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupModule } from './modules/backup/backup.module';
import { HrSheetsModule } from './modules/hr-sheets/hr-sheets.module';
import { SourceChatModule } from './modules/source-chat/chat.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { IncomesModule } from './modules/incomes/incomes.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { UnitPayrollModule } from './modules/unit-payroll/unit-payroll.module';
import { UnitLeaseModule } from './modules/unit-lease/unit-lease.module';
import { UnitBankModule } from './modules/unit-bank/unit-bank.module';
import { UnitEntriesModule } from './modules/unit-entries/unit-entries.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RegionsModule } from './modules/regions/regions.module';
import { ResultsModule } from './modules/results/results.module';
import { SalaryCompositionModule } from './modules/salary-composition/salary-composition.module';
import { EmployeeTransfersModule } from './modules/employee-transfers/employee-transfers.module';
import { LeasesModule } from './modules/leases/leases.module';
import { InternetModule } from './modules/internet/internet.module';
import { BplanModule } from './modules/bplan/bplan.module';
import { ExploreModule } from './modules/explore/explore.module';
import { HududRejaModule } from './modules/hudud-reja/hp.module';
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
import { PurchasesModule } from './modules/purchases/purchases.module';
import { EntriesModule } from './modules/entries/entries.module';
import { RolesModule } from './modules/roles/roles.module';
import { CashbookModule } from './modules/cashbook/cashbook.module';
import { RegionalDeskModule } from './modules/regional-desk/regional-desk.module';
import { RegionalDataModule } from './modules/regional-data/regional-data.module';
import { RegionalEconModule } from './modules/regional-econ/regional-econ.module';
import { HealthModule } from './modules/health/health.module';
import { ExpensePolicyModule } from './modules/expense-policy/expense-policy.module';
import { BulkDeleteModule } from './modules/bulk-delete/bulk-delete.module';
import { RateLimitGuard } from './common/security/rate-limit';

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
    UnitPayrollModule,
    UnitLeaseModule,
    UnitBankModule,
    UnitEntriesModule,
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
    ExploreModule,
    HududRejaModule,
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
    WarehouseModule,
    UsersModule,
    TelegramModule,
    PurchasesModule,
    EntriesModule,
    RolesModule,
    CashbookModule,
    RegionalDeskModule,
    RegionalDataModule,
    RegionalEconModule,
    HealthModule,
    ExpensePolicyModule,
    BulkDeleteModule,
    IntegrityModule,
    BackupModule,
    HrSheetsModule,
    SourceChatModule,
    SecurityModule,
  ],
  providers: [
    // Kirish sahifalarida urinishlar tezligini cheklash (@RateLimit)
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Ishchi rollar (Omborchi …) — faqat o'z bo'limlari
    { provide: APP_GUARD, useClass: AccessGuard },
    // Kuzatuvchi — shaxsiy ma'lumotlar yopiq (@Personal), JwtAuthGuard'dan keyin
    { provide: APP_GUARD, useClass: PersonalDataGuard },
    { provide: APP_INTERCEPTOR, useClass: PersonalMaskInterceptor },
    // Bir bo'lim ichidagi yozuvlar navbat bilan — bir vaqtdagi o'zgarishlar bir-birini o'chirmasin
    { provide: APP_INTERCEPTOR, useClass: SerializeWritesInterceptor },
  ],
})
export class AppModule {}