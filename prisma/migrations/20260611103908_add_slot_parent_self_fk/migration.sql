-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_parentSlotId_fkey" FOREIGN KEY ("parentSlotId") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
