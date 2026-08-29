-- Créneau récurrent limité à une partie de sa période (dates de début / fin).
-- Additive et nulle : un créneau existant tourne toujours sur toute sa période.
-- AlterTable
ALTER TABLE "slots" ADD COLUMN "dateStart" DATE;
ALTER TABLE "slots" ADD COLUMN "dateEnd" DATE;
