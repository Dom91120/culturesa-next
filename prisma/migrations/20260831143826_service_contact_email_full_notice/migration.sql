-- AlterTable
ALTER TABLE "services" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "fullPeriodNotice" BOOLEAN NOT NULL DEFAULT true;
