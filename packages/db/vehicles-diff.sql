-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('AI80', 'AI92', 'AI95', 'DIZEL', 'METAN', 'PROPAN', 'ELEKTR');

-- CreateEnum
CREATE TYPE "VehicleRecordKind" AS ENUM ('FUEL', 'WASH', 'REPAIR', 'SERVICE', 'OTHER');

-- AlterEnum
ALTER TYPE "EntrySource" ADD VALUE 'VEHICLE';

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

-- CreateIndex
CREATE INDEX "Vehicle_isActive_idx" ON "Vehicle"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRecord_expenseId_key" ON "VehicleRecord"("expenseId");

-- CreateIndex
CREATE INDEX "VehicleRecord_vehicleId_period_idx" ON "VehicleRecord"("vehicleId", "period");

-- CreateIndex
CREATE INDEX "VehicleRecord_period_kind_idx" ON "VehicleRecord"("period", "kind");

-- AddForeignKey
ALTER TABLE "VehicleRecord" ADD CONSTRAINT "VehicleRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
