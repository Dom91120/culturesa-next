-- AlterTable
ALTER TABLE "exercice" ADD COLUMN     "activeDays" TEXT,
ADD COLUMN     "afternoonEnd" TEXT,
ADD COLUMN     "afternoonStart" TEXT,
ADD COLUMN     "morningEnd" TEXT,
ADD COLUMN     "morningStart" TEXT,
ADD COLUMN     "openOnHolidays" BOOLEAN,
ADD COLUMN     "openOnSchoolHolidays" BOOLEAN;
