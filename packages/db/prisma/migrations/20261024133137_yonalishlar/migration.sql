-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "segment" TEXT;

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "segment" TEXT;

-- CreateIndex
CREATE INDEX "expenses_segment_period_idx" ON "expenses"("segment", "period");

-- CreateIndex
CREATE INDEX "incomes_segment_period_idx" ON "incomes"("segment", "period");
