-- CreateEnum
CREATE TYPE "ExerciceType" AS ENUM ('civile', 'scolaire');

-- AlterTable
ALTER TABLE "exercice" ADD COLUMN     "dateEnd" DATE,
ADD COLUMN     "dateStart" DATE,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "type" "ExerciceType" NOT NULL DEFAULT 'scolaire';

-- CreateIndex
CREATE INDEX "exercice_serviceId_idx" ON "exercice"("serviceId");

-- AddForeignKey
ALTER TABLE "exercice" ADD CONSTRAINT "exercice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
