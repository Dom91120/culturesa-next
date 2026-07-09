-- Maximums de réservation PAR EXERCICE : maxReservations (« par an » = sur
-- l'exercice) et maxReservationsPeriod (par période) déménagent du service vers
-- l'exercice, comme les réglages d'ouverture. Matérialisation des valeurs du
-- service dans chacun de ses exercices, puis suppression des colonnes service.
ALTER TABLE "exercice" ADD COLUMN "maxReservations" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "exercice" ADD COLUMN "maxReservationsPeriod" INTEGER NOT NULL DEFAULT 1;

UPDATE "exercice" e
SET "maxReservations"       = s."maxReservations",
    "maxReservationsPeriod" = s."maxReservationsPeriod"
FROM "services" s
WHERE e."serviceId" = s.id;

ALTER TABLE "services" DROP COLUMN "maxReservations";
ALTER TABLE "services" DROP COLUMN "maxReservationsPeriod";
