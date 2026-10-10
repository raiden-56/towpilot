-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_clientRequestId_key" ON "bookings"("clientRequestId");
