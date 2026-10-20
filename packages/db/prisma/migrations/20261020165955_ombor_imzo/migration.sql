-- AlterTable
ALTER TABLE "stock_doc_signs" ADD COLUMN     "draft" JSONB,
ADD COLUMN     "kind" TEXT,
ADD COLUMN     "photo" TEXT,
ALTER COLUMN "docId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "stock_doc_signs_createdById_status_idx" ON "stock_doc_signs"("createdById", "status");
