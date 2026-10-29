-- Bank ko'chirmasidan yo'naltirilgan yozuvlar: kontragent INN, MFO va bankdagi asl to'lov maqsadi
-- (faqat bo'sh ustunlar qo'shiladi, mavjud ma'lumotga tegmaydi)
ALTER TABLE "expenses" ADD COLUMN "counterpartyInn" TEXT;
ALTER TABLE "expenses" ADD COLUMN "counterpartyMfo" TEXT;
ALTER TABLE "expenses" ADD COLUMN "bankPurpose" TEXT;

ALTER TABLE "incomes" ADD COLUMN "counterpartyInn" TEXT;
ALTER TABLE "incomes" ADD COLUMN "counterpartyMfo" TEXT;
ALTER TABLE "incomes" ADD COLUMN "bankPurpose" TEXT;

CREATE INDEX "expenses_counterpartyInn_idx" ON "expenses"("counterpartyInn");
CREATE INDEX "incomes_counterpartyInn_idx" ON "incomes"("counterpartyInn");
