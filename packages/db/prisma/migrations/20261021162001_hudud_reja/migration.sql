-- CreateTable
CREATE TABLE "hp_stats" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "tariffTiyin" BIGINT,
    "revenueTiyin" BIGINT NOT NULL,
    "planTiyin" BIGINT,
    "sourceRef" TEXT,
    "note" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hp_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_emp_months" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "workedDays" DOUBLE PRECISION,
    "workHours" DOUBLE PRECISION,
    "vacationDays" DOUBLE PRECISION,
    "totalQuantity" DOUBLE PRECISION,
    "totalRevenueTiyin" BIGINT,
    "planTiyin" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hp_emp_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_emp_services" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "tariffTiyin" BIGINT,
    "revenueTiyin" BIGINT NOT NULL,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hp_emp_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_region_factors" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "activeEntrepreneurs" INTEGER,
    "employees" INTEGER,
    "workDays" DOUBLE PRECISION,
    "activeEmployees" INTEGER,
    "note" TEXT,
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hp_region_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_imports" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CHECKED',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB NOT NULL DEFAULT '[]',
    "policy" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),
    "importedById" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "hp_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_runs" (
    "id" TEXT NOT NULL,
    "targetPeriod" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "paramsHash" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "result" JSONB,
    "summary" JSONB,
    "edits" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "tookMs" INTEGER,

    CONSTRAINT "hp_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hp_plan_versions" (
    "id" TEXT NOT NULL,
    "targetPeriod" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "forecastTiyin" BIGINT NOT NULL,
    "employeesTiyin" BIGINT NOT NULL,
    "unallocatedTiyin" BIGINT NOT NULL,
    "data" JSONB NOT NULL,
    "note" TEXT,
    "restoredFrom" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hp_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hp_stats_regionCode_period_idx" ON "hp_stats"("regionCode", "period");

-- CreateIndex
CREATE UNIQUE INDEX "hp_stats_period_regionCode_serviceCode_key" ON "hp_stats"("period", "regionCode", "serviceCode");

-- CreateIndex
CREATE INDEX "hp_emp_months_regionCode_period_idx" ON "hp_emp_months"("regionCode", "period");

-- CreateIndex
CREATE UNIQUE INDEX "hp_emp_months_period_employeePinfl_key" ON "hp_emp_months"("period", "employeePinfl");

-- CreateIndex
CREATE INDEX "hp_emp_services_regionCode_period_idx" ON "hp_emp_services"("regionCode", "period");

-- CreateIndex
CREATE INDEX "hp_emp_services_employeePinfl_period_idx" ON "hp_emp_services"("employeePinfl", "period");

-- CreateIndex
CREATE UNIQUE INDEX "hp_emp_services_period_regionCode_employeePinfl_serviceCode_key" ON "hp_emp_services"("period", "regionCode", "employeePinfl", "serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "hp_region_factors_period_regionCode_key" ON "hp_region_factors"("period", "regionCode");

-- CreateIndex
CREATE INDEX "hp_imports_kind_createdAt_idx" ON "hp_imports"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "hp_imports_fileHash_idx" ON "hp_imports"("fileHash");

-- CreateIndex
CREATE INDEX "hp_runs_targetPeriod_createdAt_idx" ON "hp_runs"("targetPeriod", "createdAt");

-- CreateIndex
CREATE INDEX "hp_runs_paramsHash_dataHash_idx" ON "hp_runs"("paramsHash", "dataHash");

-- CreateIndex
CREATE INDEX "hp_plan_versions_targetPeriod_status_idx" ON "hp_plan_versions"("targetPeriod", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hp_plan_versions_targetPeriod_regionCode_version_key" ON "hp_plan_versions"("targetPeriod", "regionCode", "version");
