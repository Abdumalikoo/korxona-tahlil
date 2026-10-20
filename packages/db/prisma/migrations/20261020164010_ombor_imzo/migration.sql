-- CreateTable
CREATE TABLE "stock_doc_signs" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "signerPinfl" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "method" TEXT,
    "signature" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedAgent" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "archive" BYTEA,
    "archiveName" TEXT,
    "telegram" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_doc_signs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_doc_signs_docId_key" ON "stock_doc_signs"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_doc_signs_token_key" ON "stock_doc_signs"("token");

-- CreateIndex
CREATE INDEX "stock_doc_signs_status_idx" ON "stock_doc_signs"("status");

-- CreateIndex
CREATE INDEX "stock_doc_signs_signerPinfl_status_idx" ON "stock_doc_signs"("signerPinfl", "status");
