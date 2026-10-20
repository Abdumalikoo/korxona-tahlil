-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "bodyType" TEXT,
ADD COLUMN     "fuelCardNo" TEXT;

-- AlterTable
ALTER TABLE "VehicleRecord" ADD COLUMN     "importKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "VehicleRecord_importKey_key" ON "VehicleRecord"("importKey");
