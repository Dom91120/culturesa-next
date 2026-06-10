-- CreateTable
CREATE TABLE "booking_reminders" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "slotDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_reminders_slotDate_idx" ON "booking_reminders"("slotDate");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reminders_bookingId_slotDate_kind_key" ON "booking_reminders"("bookingId", "slotDate", "kind");

-- AddForeignKey
ALTER TABLE "booking_reminders" ADD CONSTRAINT "booking_reminders_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
