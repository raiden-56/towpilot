-- AlterTable
ALTER TABLE "driver_earnings" ADD COLUMN     "expenseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_expenseId_key" ON "driver_earnings"("expenseId");
