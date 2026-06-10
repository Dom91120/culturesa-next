-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_parentBookingId_fkey" FOREIGN KEY ("parentBookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
