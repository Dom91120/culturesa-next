-- Vacances scolaires : disponibilité des jours de vacances au niveau du service.
-- false (défaut) = jours de vacances hachurés / non réservables (agenda + réservations).
-- AlterTable
ALTER TABLE "services" ADD COLUMN     "openOnSchoolHolidays" BOOLEAN NOT NULL DEFAULT false;
