-- DropIndex
DROP INDEX "bookings_serviceId_idx";

-- CreateIndex
CREATE INDEX "bookings_serviceId_periodId_createdAt_idx" ON "bookings"("serviceId", "periodId", "createdAt");
