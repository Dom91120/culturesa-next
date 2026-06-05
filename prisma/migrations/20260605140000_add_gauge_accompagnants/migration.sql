-- Jauge : compter ou non les accompagnants dans les places (défaut true = historique).
-- AlterTable
ALTER TABLE "services" ADD COLUMN     "gaugeAccompagnants" BOOLEAN NOT NULL DEFAULT true;
