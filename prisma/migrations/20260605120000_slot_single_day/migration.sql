-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim');

-- DropIndex
DROP INDEX "bookings_userId_serviceId_slotId_periodId_dayKey_week_key";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "dayKey";

-- AlterTable
ALTER TABLE "slots" DROP COLUMN "capDim",
DROP COLUMN "capJeu",
DROP COLUMN "capLun",
DROP COLUMN "capMar",
DROP COLUMN "capMer",
DROP COLUMN "capSam",
DROP COLUMN "capVen",
ADD COLUMN     "slotDay" "DayOfWeek";

-- CreateTable
CREATE TABLE "service_manager" (
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "service_manager_pkey" PRIMARY KEY ("userId","serviceId")
);

-- CreateIndex
CREATE INDEX "service_manager_serviceId_idx" ON "service_manager"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_userId_serviceId_slotId_periodId_week_key" ON "bookings"("userId", "serviceId", "slotId", "periodId", "week");

-- AddForeignKey
ALTER TABLE "service_manager" ADD CONSTRAINT "service_manager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_manager" ADD CONSTRAINT "service_manager_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
