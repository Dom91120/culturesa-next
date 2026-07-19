-- AlterTable
ALTER TABLE "slots" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "slots_batchId_idx" ON "slots"("batchId");
