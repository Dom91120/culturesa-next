-- CreateIndex
CREATE INDEX "bookings_serviceId_validated_idx" ON "bookings"("serviceId", "validated");

-- CreateIndex
CREATE INDEX "bookings_serviceId_autoValidatedAt_idx" ON "bookings"("serviceId", "autoValidatedAt");
