-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER', 'SKLADCHI', 'XARIDCHI', 'BUXGALTER', 'HUDUDCHI');

-- CreateEnum
CREATE TYPE "CostBehavior" AS ENUM ('FIXED', 'VARIABLE', 'MIXED');

-- CreateEnum
CREATE TYPE "CostScope" AS ENUM ('DEPARTMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'IMPORT', 'PAYROLL', 'LEASE', 'VEHICLE', 'WAREHOUSE', 'ASSET', 'TAX');

-- CreateEnum
CREATE TYPE "EntrySection" AS ENUM ('DOIMIY', 'BOSHQA');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'PARTIAL', 'UNPAID');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SHTAT', 'SHARTNOMA');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('PAYROLL', 'EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'READY', 'COMMITTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RowStatus" AS ENUM ('VALID', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'LOGIN', 'IMPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "PayrollBatchStatus" AS ENUM ('DRAFT', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalaryComponentGroup" AS ENUM ('BUDGET', 'HOJALIK');

-- CreateEnum
CREATE TYPE "SalaryComponentCategory" AS ENUM ('ASOSIY', 'TATIL', 'PREMIYA', 'KOMPENSATSIYA', 'USTAMA', 'JARIMA', 'BOSHQA');

-- CreateEnum
CREATE TYPE "SalaryCompositionStatus" AS ENUM ('MATCHED', 'MISMATCH', 'NO_PAYROLL');

-- CreateEnum
CREATE TYPE "LeaseKind" AS ENUM ('ODDIY', 'AEROPORT');

-- CreateEnum
CREATE TYPE "LeasePaymentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "LeaseDocumentType" AS ENUM ('SHARTNOMA', 'QOSHIMCHA_KELISHUV', 'DALOLATNOMA', 'BOSHQA');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('AI80', 'AI92', 'AI95', 'DIZEL', 'METAN', 'PROPAN', 'ELEKTR');

-- CreateEnum
CREATE TYPE "VehicleRecordKind" AS ENUM ('FUEL', 'WASH', 'REPAIR', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReactionStatus" AS ENUM ('OPEN', 'CLOSED', 'CONTROL');

-- CreateEnum
CREATE TYPE "StockItemKind" AS ENUM ('TMZ', 'ASSET');

-- CreateEnum
CREATE TYPE "StockDocKind" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'IN_USE', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'DONE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseKind" AS ENUM ('EXCHANGE', 'DIRECT');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('OPEN', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "loginCode" TEXT,
    "pinHash" TEXT,
    "mustChangePin" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "allocationWeight" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentCode" TEXT,
    "isLeaf" BOOLEAN NOT NULL DEFAULT true,
    "behavior" "CostBehavior" NOT NULL DEFAULT 'VARIABLE',
    "scope" "CostScope" NOT NULL DEFAULT 'GENERAL',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model3d" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "income_categories" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_categories_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "expenses" (
    "districtId" TEXT,
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "departmentId" TEXT,
    "regionCode" INTEGER,
    "description" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK',
    "documentNo" TEXT,
    "counterparty" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "dueDate" TIMESTAMP(3),
    "responsible" TEXT,
    "vatTiyin" BIGINT,
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "section" "EntrySection" NOT NULL DEFAULT 'DOIMIY',
    "importBatchId" TEXT,
    "payrollBatchId" TEXT,
    "recurrence" TEXT,
    "categoryConfidence" INTEGER,
    "categoryOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incomes" (
    "districtId" TEXT,
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "paidTiyin" BIGINT NOT NULL DEFAULT 0,
    "categoryCode" TEXT NOT NULL,
    "departmentId" TEXT,
    "regionCode" INTEGER,
    "quantity" INTEGER,
    "clientName" TEXT,
    "description" TEXT,
    "contractNo" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'BANK',
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "section" "EntrySection" NOT NULL DEFAULT 'DOIMIY',
    "importBatchId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "pinfl" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "fullName" TEXT NOT NULL,
    "employmentType" "EmploymentType" NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "districtId" TEXT,
    "departmentId" TEXT,
    "position" TEXT,
    "hiredAt" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("pinfl")
);

-- CreateTable
CREATE TABLE "payroll_entries" (
    "id" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "baseTiyin" BIGINT NOT NULL DEFAULT 0,
    "bonusTiyin" BIGINT NOT NULL DEFAULT 0,
    "vacationTiyin" BIGINT NOT NULL DEFAULT 0,
    "deductionTiyin" BIGINT NOT NULL DEFAULT 0,
    "taxTiyin" BIGINT NOT NULL DEFAULT 0,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "workedDays" INTEGER,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "period" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "committedRows" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staging_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "parsedData" JSONB,
    "status" "RowStatus" NOT NULL DEFAULT 'VALID',
    "messages" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "staging_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_batches" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayrollBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "matchedRows" INTEGER NOT NULL DEFAULT 0,
    "missingRows" INTEGER NOT NULL DEFAULT 0,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "missingPinfls" JSONB NOT NULL DEFAULT '[]',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "result_batches" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "planTiyin" BIGINT NOT NULL DEFAULT 0,
    "factTiyin" BIGINT NOT NULL DEFAULT 0,
    "bonusTiyin" BIGINT NOT NULL DEFAULT 0,
    "movedCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "result_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_results" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "districtId" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'SHTAT',
    "planTiyin" BIGINT NOT NULL DEFAULT 0,
    "factTiyin" BIGINT NOT NULL DEFAULT 0,
    "bonusTiyin" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "employee_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_locations" (
    "id" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "districtId" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'SHTAT',
    "source" TEXT NOT NULL DEFAULT 'RESULTS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryComponent" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "SalaryComponentGroup" NOT NULL,
    "category" "SalaryComponentCategory" NOT NULL,
    "sign" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryComponent_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "SalaryCompositionBatch" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fileName" TEXT,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "payrollTiyin" BIGINT NOT NULL DEFAULT 0,
    "status" "SalaryCompositionStatus" NOT NULL DEFAULT 'NO_PAYROLL',
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SalaryCompositionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryCompositionRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "fullName" TEXT,
    "workedDays" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "SalaryCompositionRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryCompositionItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,

    CONSTRAINT "SalaryCompositionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lease" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "contractDate" TIMESTAMP(3),
    "kind" "LeaseKind" NOT NULL DEFAULT 'ODDIY',
    "title" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "districtId" TEXT,
    "departmentId" TEXT,
    "airportName" TEXT,
    "address" TEXT,
    "areaM2" DOUBLE PRECISION,
    "purpose" TEXT,
    "lessorName" TEXT NOT NULL,
    "lessorTin" TEXT,
    "lessorPhone" TEXT,
    "lessorBank" TEXT,
    "vatIncluded" BOOLEAN NOT NULL DEFAULT true,
    "paymentFrequency" "LeasePaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "paymentDay" INTEGER,
    "startPeriod" TEXT NOT NULL,
    "endPeriod" TEXT,
    "endReason" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Lease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseTerm" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "validFrom" TEXT NOT NULL,
    "monthlyTiyin" BIGINT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseDocument" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "termId" TEXT,
    "type" "LeaseDocumentType" NOT NULL DEFAULT 'SHARTNOMA',
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseMonthClose" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "leaseCount" INTEGER NOT NULL DEFAULT 0,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "LeaseMonthClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseAccrual" (
    "id" TEXT NOT NULL,
    "closeId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "expenseId" TEXT,

    CONSTRAINT "LeaseAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "fuelType" "VehicleFuelType" NOT NULL DEFAULT 'AI92',
    "fuelNorm" DOUBLE PRECISION,
    "regionCode" INTEGER NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "initialOdometerKm" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "fleetGroup" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleRecord" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "VehicleRecordKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "liters" DOUBLE PRECISION,
    "odometerKm" INTEGER,
    "description" TEXT,
    "counterparty" TEXT,
    "documentNo" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "expenseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VehicleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReactionStatus" NOT NULL DEFAULT 'OPEN',
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "baseFrom" TIMESTAMP(3) NOT NULL,
    "baseTo" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reaction_items" (
    "id" TEXT NOT NULL,
    "reactionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "origin" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reaction_assignees" (
    "id" TEXT NOT NULL,
    "reactionId" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Mas''ul',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reaction_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_rules" (
    "id" TEXT NOT NULL,
    "reactionId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "limitTiyin" BIGINT NOT NULL,
    "startPeriod" TEXT NOT NULL,
    "assignees" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "content" BYTEA NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'dona',
    "kind" "StockItemKind" NOT NULL DEFAULT 'TMZ',
    "group" TEXT,
    "categoryCode" TEXT NOT NULL,
    "minQty" DOUBLE PRECISION,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_docs" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "StockDocKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "counterparty" TEXT,
    "documentNo" TEXT,
    "departmentId" TEXT,
    "regionCode" INTEGER,
    "holderPinfl" TEXT,
    "holderName" TEXT,
    "fromDepartmentId" TEXT,
    "fromRegionCode" INTEGER,
    "fromHolderPinfl" TEXT,
    "fromHolderName" TEXT,
    "issuedBy" TEXT,
    "responsible" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "stock_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lines" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "priceTiyin" BIGINT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "expenseId" TEXT,
    "note" TEXT,

    CONSTRAINT "stock_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "inventoryNo" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNo" TEXT,
    "priceTiyin" BIGINT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "receiptLineId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "departmentId" TEXT,
    "regionCode" INTEGER,
    "holderPinfl" TEXT,
    "holderName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_moves" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "docId" TEXT,
    "kind" "StockDocKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fromDepartmentId" TEXT,
    "fromRegionCode" INTEGER,
    "fromHolderPinfl" TEXT,
    "fromHolderName" TEXT,
    "toDepartmentId" TEXT,
    "toRegionCode" INTEGER,
    "toHolderPinfl" TEXT,
    "toHolderName" TEXT,
    "note" TEXT,
    "condition" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "chairman" TEXT,
    "commission" TEXT,
    "note" TEXT,
    "writeOffDocId" TEXT,
    "receiptDocId" TEXT,
    "createdById" TEXT,
    "finishedById" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actualQty" DOUBLE PRECISION,
    "bookQty" DOUBLE PRECISION,
    "priceTiyin" BIGINT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_assets" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "found" BOOLEAN,

    CONSTRAINT "stock_count_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postal_payments" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "documentNo" TEXT,
    "note" TEXT,
    "expenseId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "postal_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "pinfl" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "remindHours" INTEGER[],
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reminders" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "hoursBefore" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_links" (
    "pinfl" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("pinfl")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "code" TEXT NOT NULL,
    "pinfl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requests" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "departmentId" TEXT,
    "requester" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'NEW',
    "rejectReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_request_lines" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'dona',
    "itemId" TEXT,

    CONSTRAINT "purchase_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "PurchaseKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "lotNo" TEXT,
    "exchange" TEXT,
    "documentNo" TEXT,
    "deliveryDue" TIMESTAMP(3),
    "paymentDue" TIMESTAMP(3),
    "requestId" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'OPEN',
    "totalTiyin" BIGINT NOT NULL DEFAULT 0,
    "feeTiyin" BIGINT NOT NULL DEFAULT 0,
    "feeExpenseId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "priceTiyin" BIGINT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_payments" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "rejectReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "stockDocId" TEXT,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "priceTiyin" BIGINT NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "parentId" TEXT,
    "rollupId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "inputs" TEXT[],
    "sums" TEXT[],
    "balanceRule" TEXT NOT NULL DEFAULT 'ADD',
    "isHeader" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_reports" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_report_lines" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ytdTiyin" BIGINT,
    "mtdTiyin" BIGINT,
    "refundTiyin" BIGINT,
    "dailyTiyin" BIGINT,
    "balanceTiyin" BIGINT,

    CONSTRAINT "cash_report_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regional_period_closes" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLOSED',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenReason" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regional_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_events" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "regionCode" INTEGER,
    "categoryCode" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isBreak" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "analysis_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_tariffs" (
    "id" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "regionCode" INTEGER,
    "priceTiyin" BIGINT NOT NULL,
    "validFrom" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" TEXT NOT NULL,
    "employeePinfl" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "baseSalaryTiyin" BIGINT NOT NULL,
    "position" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_budgets" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overhead_rules" (
    "id" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "driver" TEXT,
    "validFrom" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overhead_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overhead_driver_values" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overhead_driver_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_runs" (
    "id" TEXT NOT NULL,
    "lastActual" TEXT NOT NULL,
    "horizon" INTEGER NOT NULL,
    "note" TEXT,
    "summary" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_targets" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "regionCode" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "suggestedTiyin" BIGINT NOT NULL,
    "suggestBasis" JSONB NOT NULL DEFAULT '{}',
    "proposedTiyin" BIGINT,
    "approvedTiyin" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_target_logs" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "valueTiyin" BIGINT,
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_target_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "costTiyin" BIGINT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "lifeMonths" INTEGER NOT NULL,
    "lifeOverridden" BOOLEAN NOT NULL DEFAULT false,
    "regionCode" INTEGER,
    "departmentId" TEXT,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'BALANCE',
    "assetId" TEXT,
    "inventoryNo" TEXT,
    "expenseId" TEXT,
    "disposedAt" TIMESTAMP(3),
    "disposeReason" TEXT,
    "holderName" TEXT,
    "placeText" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "importBatch" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_loginCode_key" ON "users"("loginCode");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_index_key" ON "departments"("index");

-- CreateIndex
CREATE INDEX "departments_isActive_order_idx" ON "departments"("isActive", "order");

-- CreateIndex
CREATE INDEX "categories_parentCode_idx" ON "categories"("parentCode");

-- CreateIndex
CREATE INDEX "categories_isActive_order_idx" ON "categories"("isActive", "order");

-- CreateIndex
CREATE INDEX "income_categories_isActive_order_idx" ON "income_categories"("isActive", "order");

-- CreateIndex
CREATE INDEX "expenses_period_deletedAt_idx" ON "expenses"("period", "deletedAt");

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

-- CreateIndex
CREATE INDEX "expenses_categoryCode_period_idx" ON "expenses"("categoryCode", "period");

-- CreateIndex
CREATE INDEX "expenses_departmentId_period_idx" ON "expenses"("departmentId", "period");

-- CreateIndex
CREATE INDEX "expenses_importBatchId_idx" ON "expenses"("importBatchId");

-- CreateIndex
CREATE INDEX "expenses_paymentStatus_idx" ON "expenses"("paymentStatus");

-- CreateIndex
CREATE INDEX "expenses_regionCode_period_idx" ON "expenses"("regionCode", "period");

-- CreateIndex
CREATE INDEX "expenses_section_period_idx" ON "expenses"("section", "period");

-- CreateIndex
CREATE INDEX "expenses_districtId_period_idx" ON "expenses"("districtId", "period");

-- CreateIndex
CREATE INDEX "expenses_payrollBatchId_idx" ON "expenses"("payrollBatchId");

-- CreateIndex
CREATE INDEX "expenses_createdById_idx" ON "expenses"("createdById");

-- CreateIndex
CREATE INDEX "incomes_period_deletedAt_idx" ON "incomes"("period", "deletedAt");

-- CreateIndex
CREATE INDEX "incomes_date_idx" ON "incomes"("date");

-- CreateIndex
CREATE INDEX "incomes_categoryCode_period_idx" ON "incomes"("categoryCode", "period");

-- CreateIndex
CREATE INDEX "incomes_departmentId_period_idx" ON "incomes"("departmentId", "period");

-- CreateIndex
CREATE INDEX "incomes_paymentStatus_idx" ON "incomes"("paymentStatus");

-- CreateIndex
CREATE INDEX "incomes_regionCode_period_idx" ON "incomes"("regionCode", "period");

-- CreateIndex
CREATE INDEX "incomes_section_period_idx" ON "incomes"("section", "period");

-- CreateIndex
CREATE INDEX "incomes_districtId_period_idx" ON "incomes"("districtId", "period");

-- CreateIndex
CREATE INDEX "employees_regionCode_isActive_idx" ON "employees"("regionCode", "isActive");

-- CreateIndex
CREATE INDEX "employees_departmentId_isActive_idx" ON "employees"("departmentId", "isActive");

-- CreateIndex
CREATE INDEX "employees_employmentType_idx" ON "employees"("employmentType");

-- CreateIndex
CREATE INDEX "employees_fullName_idx" ON "employees"("fullName");

-- CreateIndex
CREATE INDEX "payroll_entries_period_idx" ON "payroll_entries"("period");

-- CreateIndex
CREATE INDEX "payroll_entries_batchId_idx" ON "payroll_entries"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_employeePinfl_period_batchId_key" ON "payroll_entries"("employeePinfl", "period", "batchId");

-- CreateIndex
CREATE INDEX "import_batches_type_status_idx" ON "import_batches"("type", "status");

-- CreateIndex
CREATE INDEX "import_batches_fileHash_idx" ON "import_batches"("fileHash");

-- CreateIndex
CREATE INDEX "staging_rows_batchId_status_idx" ON "staging_rows"("batchId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "districts_regionCode_idx" ON "districts"("regionCode");

-- CreateIndex
CREATE UNIQUE INDEX "districts_regionCode_code_key" ON "districts"("regionCode", "code");

-- CreateIndex
CREATE INDEX "payroll_batches_period_status_idx" ON "payroll_batches"("period", "status");

-- CreateIndex
CREATE INDEX "payroll_batches_fileHash_idx" ON "payroll_batches"("fileHash");

-- CreateIndex
CREATE INDEX "result_batches_period_idx" ON "result_batches"("period");

-- CreateIndex
CREATE INDEX "employee_results_period_regionCode_idx" ON "employee_results"("period", "regionCode");

-- CreateIndex
CREATE INDEX "employee_results_employeePinfl_period_idx" ON "employee_results"("employeePinfl", "period");

-- CreateIndex
CREATE UNIQUE INDEX "employee_results_batchId_employeePinfl_key" ON "employee_results"("batchId", "employeePinfl");

-- CreateIndex
CREATE INDEX "employee_locations_period_regionCode_idx" ON "employee_locations"("period", "regionCode");

-- CreateIndex
CREATE UNIQUE INDEX "employee_locations_employeePinfl_period_key" ON "employee_locations"("employeePinfl", "period");

-- CreateIndex
CREATE INDEX "SalaryCompositionBatch_period_idx" ON "SalaryCompositionBatch"("period");

-- CreateIndex
CREATE INDEX "SalaryCompositionRow_period_employeePinfl_idx" ON "SalaryCompositionRow"("period", "employeePinfl");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryCompositionRow_batchId_employeePinfl_key" ON "SalaryCompositionRow"("batchId", "employeePinfl");

-- CreateIndex
CREATE INDEX "SalaryCompositionItem_batchId_componentCode_idx" ON "SalaryCompositionItem"("batchId", "componentCode");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryCompositionItem_rowId_componentCode_key" ON "SalaryCompositionItem"("rowId", "componentCode");

-- CreateIndex
CREATE INDEX "Lease_regionCode_idx" ON "Lease"("regionCode");

-- CreateIndex
CREATE INDEX "Lease_kind_idx" ON "Lease"("kind");

-- CreateIndex
CREATE INDEX "Lease_startPeriod_endPeriod_idx" ON "Lease"("startPeriod", "endPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseTerm_leaseId_validFrom_key" ON "LeaseTerm"("leaseId", "validFrom");

-- CreateIndex
CREATE INDEX "LeaseDocument_leaseId_idx" ON "LeaseDocument"("leaseId");

-- CreateIndex
CREATE INDEX "LeaseMonthClose_period_idx" ON "LeaseMonthClose"("period");

-- CreateIndex
CREATE INDEX "LeaseAccrual_period_idx" ON "LeaseAccrual"("period");

-- CreateIndex
CREATE INDEX "LeaseAccrual_expenseId_idx" ON "LeaseAccrual"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseAccrual_leaseId_period_key" ON "LeaseAccrual"("leaseId", "period");

-- CreateIndex
CREATE INDEX "Vehicle_isActive_idx" ON "Vehicle"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRecord_expenseId_key" ON "VehicleRecord"("expenseId");

-- CreateIndex
CREATE INDEX "VehicleRecord_vehicleId_period_idx" ON "VehicleRecord"("vehicleId", "period");

-- CreateIndex
CREATE INDEX "VehicleRecord_period_kind_idx" ON "VehicleRecord"("period", "kind");

-- CreateIndex
CREATE INDEX "reactions_status_dueDate_idx" ON "reactions"("status", "dueDate");

-- CreateIndex
CREATE INDEX "reaction_items_reactionId_idx" ON "reaction_items"("reactionId");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_assignees_reactionId_employeePinfl_key" ON "reaction_assignees"("reactionId", "employeePinfl");

-- CreateIndex
CREATE INDEX "control_rules_isActive_idx" ON "control_rules"("isActive");

-- CreateIndex
CREATE INDEX "report_runs_createdAt_idx" ON "report_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_code_key" ON "stock_items"("code");

-- CreateIndex
CREATE INDEX "stock_items_kind_isActive_idx" ON "stock_items"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "stock_docs_number_key" ON "stock_docs"("number");

-- CreateIndex
CREATE INDEX "stock_docs_kind_period_idx" ON "stock_docs"("kind", "period");

-- CreateIndex
CREATE INDEX "stock_docs_date_idx" ON "stock_docs"("date");

-- CreateIndex
CREATE INDEX "stock_docs_departmentId_idx" ON "stock_docs"("departmentId");

-- CreateIndex
CREATE INDEX "stock_docs_regionCode_idx" ON "stock_docs"("regionCode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lines_expenseId_key" ON "stock_lines"("expenseId");

-- CreateIndex
CREATE INDEX "stock_lines_docId_idx" ON "stock_lines"("docId");

-- CreateIndex
CREATE INDEX "stock_lines_itemId_idx" ON "stock_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_inventoryNo_key" ON "assets"("inventoryNo");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "assets_departmentId_idx" ON "assets"("departmentId");

-- CreateIndex
CREATE INDEX "assets_regionCode_idx" ON "assets"("regionCode");

-- CreateIndex
CREATE INDEX "assets_holderPinfl_idx" ON "assets"("holderPinfl");

-- CreateIndex
CREATE INDEX "asset_moves_assetId_date_idx" ON "asset_moves"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_number_key" ON "stock_counts"("number");

-- CreateIndex
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_itemId_key" ON "stock_count_lines"("countId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_assets_countId_assetId_key" ON "stock_count_assets"("countId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "postal_payments_expenseId_key" ON "postal_payments"("expenseId");

-- CreateIndex
CREATE INDEX "postal_payments_period_idx" ON "postal_payments"("period");

-- CreateIndex
CREATE INDEX "tasks_status_deadline_idx" ON "tasks"("status", "deadline");

-- CreateIndex
CREATE INDEX "tasks_pinfl_idx" ON "tasks"("pinfl");

-- CreateIndex
CREATE INDEX "task_reminders_sentAt_dueAt_idx" ON "task_reminders"("sentAt", "dueAt");

-- CreateIndex
CREATE INDEX "task_reminders_taskId_idx" ON "task_reminders"("taskId");

-- CreateIndex
CREATE INDEX "telegram_links_chatId_idx" ON "telegram_links"("chatId");

-- CreateIndex
CREATE INDEX "telegram_link_codes_pinfl_idx" ON "telegram_link_codes"("pinfl");

-- CreateIndex
CREATE INDEX "telegram_link_codes_expiresAt_idx" ON "telegram_link_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_number_key" ON "purchase_requests"("number");

-- CreateIndex
CREATE INDEX "purchase_requests_status_date_idx" ON "purchase_requests"("status", "date");

-- CreateIndex
CREATE INDEX "purchase_request_lines_requestId_idx" ON "purchase_request_lines"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_number_key" ON "purchases"("number");

-- CreateIndex
CREATE INDEX "purchases_status_date_idx" ON "purchases"("status", "date");

-- CreateIndex
CREATE INDEX "purchases_supplierId_idx" ON "purchases"("supplierId");

-- CreateIndex
CREATE INDEX "purchases_kind_period_idx" ON "purchases"("kind", "period");

-- CreateIndex
CREATE INDEX "purchase_lines_purchaseId_idx" ON "purchase_lines"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_lines_itemId_idx" ON "purchase_lines"("itemId");

-- CreateIndex
CREATE INDEX "purchase_payments_purchaseId_idx" ON "purchase_payments"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_number_key" ON "goods_receipts"("number");

-- CreateIndex
CREATE INDEX "goods_receipts_status_date_idx" ON "goods_receipts"("status", "date");

-- CreateIndex
CREATE INDEX "goods_receipts_purchaseId_idx" ON "goods_receipts"("purchaseId");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_receiptId_idx" ON "goods_receipt_lines"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_key_key" ON "cash_accounts"("key");

-- CreateIndex
CREATE INDEX "cash_accounts_parentId_idx" ON "cash_accounts"("parentId");

-- CreateIndex
CREATE INDEX "cash_accounts_rollupId_idx" ON "cash_accounts"("rollupId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_reports_date_key" ON "cash_reports"("date");

-- CreateIndex
CREATE INDEX "cash_reports_updatedAt_idx" ON "cash_reports"("updatedAt");

-- CreateIndex
CREATE INDEX "cash_report_lines_accountId_idx" ON "cash_report_lines"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_report_lines_reportId_accountId_key" ON "cash_report_lines"("reportId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "regional_period_closes_period_key" ON "regional_period_closes"("period");

-- CreateIndex
CREATE INDEX "analysis_events_date_idx" ON "analysis_events"("date");

-- CreateIndex
CREATE INDEX "analysis_events_regionCode_idx" ON "analysis_events"("regionCode");

-- CreateIndex
CREATE INDEX "service_tariffs_categoryCode_validFrom_idx" ON "service_tariffs"("categoryCode", "validFrom");

-- CreateIndex
CREATE INDEX "service_tariffs_status_idx" ON "service_tariffs"("status");

-- CreateIndex
CREATE INDEX "employee_salaries_effectiveFrom_idx" ON "employee_salaries"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salaries_employeePinfl_effectiveFrom_key" ON "employee_salaries"("employeePinfl", "effectiveFrom");

-- CreateIndex
CREATE INDEX "expense_budgets_period_idx" ON "expense_budgets"("period");

-- CreateIndex
CREATE UNIQUE INDEX "expense_budgets_period_regionCode_categoryCode_key" ON "expense_budgets"("period", "regionCode", "categoryCode");

-- CreateIndex
CREATE INDEX "overhead_rules_unitKey_idx" ON "overhead_rules"("unitKey");

-- CreateIndex
CREATE UNIQUE INDEX "overhead_rules_unitKey_validFrom_key" ON "overhead_rules"("unitKey", "validFrom");

-- CreateIndex
CREATE INDEX "overhead_driver_values_period_unitKey_idx" ON "overhead_driver_values"("period", "unitKey");

-- CreateIndex
CREATE UNIQUE INDEX "overhead_driver_values_period_unitKey_regionCode_key" ON "overhead_driver_values"("period", "unitKey", "regionCode");

-- CreateIndex
CREATE INDEX "forecast_runs_lastActual_idx" ON "forecast_runs"("lastActual");

-- CreateIndex
CREATE INDEX "forecast_runs_createdAt_idx" ON "forecast_runs"("createdAt");

-- CreateIndex
CREATE INDEX "kpi_targets_period_idx" ON "kpi_targets"("period");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_targets_period_regionCode_metric_key" ON "kpi_targets"("period", "regionCode", "metric");

-- CreateIndex
CREATE INDEX "kpi_target_logs_targetId_idx" ON "kpi_target_logs"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_assetId_key" ON "fixed_assets"("assetId");

-- CreateIndex
CREATE INDEX "fixed_assets_deletedAt_mode_idx" ON "fixed_assets"("deletedAt", "mode");

-- CreateIndex
CREATE INDEX "fixed_assets_expenseId_idx" ON "fixed_assets"("expenseId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "categories"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payrollBatchId_fkey" FOREIGN KEY ("payrollBatchId") REFERENCES "payroll_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "income_categories"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employeePinfl_fkey" FOREIGN KEY ("employeePinfl") REFERENCES "employees"("pinfl") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "payroll_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staging_rows" ADD CONSTRAINT "staging_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_results" ADD CONSTRAINT "employee_results_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "result_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_results" ADD CONSTRAINT "employee_results_employeePinfl_fkey" FOREIGN KEY ("employeePinfl") REFERENCES "employees"("pinfl") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_results" ADD CONSTRAINT "employee_results_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_results" ADD CONSTRAINT "employee_results_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_employeePinfl_fkey" FOREIGN KEY ("employeePinfl") REFERENCES "employees"("pinfl") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_locations" ADD CONSTRAINT "employee_locations_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryCompositionRow" ADD CONSTRAINT "SalaryCompositionRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalaryCompositionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryCompositionItem" ADD CONSTRAINT "SalaryCompositionItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalaryCompositionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryCompositionItem" ADD CONSTRAINT "SalaryCompositionItem_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SalaryCompositionRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryCompositionItem" ADD CONSTRAINT "SalaryCompositionItem_componentCode_fkey" FOREIGN KEY ("componentCode") REFERENCES "SalaryComponent"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseTerm" ADD CONSTRAINT "LeaseTerm_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseDocument" ADD CONSTRAINT "LeaseDocument_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseDocument" ADD CONSTRAINT "LeaseDocument_termId_fkey" FOREIGN KEY ("termId") REFERENCES "LeaseTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseAccrual" ADD CONSTRAINT "LeaseAccrual_closeId_fkey" FOREIGN KEY ("closeId") REFERENCES "LeaseMonthClose"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseAccrual" ADD CONSTRAINT "LeaseAccrual_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleRecord" ADD CONSTRAINT "VehicleRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_items" ADD CONSTRAINT "reaction_items_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "reactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reaction_assignees" ADD CONSTRAINT "reaction_assignees_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "reactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_rules" ADD CONSTRAINT "control_rules_reactionId_fkey" FOREIGN KEY ("reactionId") REFERENCES "reactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lines" ADD CONSTRAINT "stock_lines_docId_fkey" FOREIGN KEY ("docId") REFERENCES "stock_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lines" ADD CONSTRAINT "stock_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_moves" ADD CONSTRAINT "asset_moves_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_moves" ADD CONSTRAINT "asset_moves_docId_fkey" FOREIGN KEY ("docId") REFERENCES "stock_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_assets" ADD CONSTRAINT "stock_count_assets_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_report_lines" ADD CONSTRAINT "cash_report_lines_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "cash_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_report_lines" ADD CONSTRAINT "cash_report_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_target_logs" ADD CONSTRAINT "kpi_target_logs_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "kpi_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
