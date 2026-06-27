-- Booking.periodId : passage du sentinelle 0 (fausse FK) à une vraie FK nullable.

-- 1) Rendre la colonne nullable et retirer le défaut sentinelle 0.
ALTER TABLE "bookings" ALTER COLUMN "periodId" DROP NOT NULL,
ALTER COLUMN "periodId" DROP DEFAULT;

-- 2) Migrer le sentinelle 0 → NULL (réservations ponctuelles / enfants d'occurrence).
UPDATE "bookings" SET "periodId" = NULL WHERE "periodId" = 0;

-- 3) Nettoyer d'éventuelles lignes orphelines (periodId pointant une période supprimée)
--    avant d'ajouter la FK (sinon l'ajout échouerait). Base dev, pas de prod.
UPDATE "bookings" b SET "periodId" = NULL
WHERE b."periodId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "periods" p WHERE p."id" = b."periodId");

-- 4) Recréer l'unicité uq_recurring en NULLS NOT DISTINCT : les réservations ponctuelles
--    et les enfants d'occurrence ont periodId NULL ; sans NULLS NOT DISTINCT, Postgres
--    traiterait chaque NULL comme distinct → plus aucune déduplication (double-réservation
--    possible, skipDuplicates inopérant). Prisma ne sait pas exprimer cette option dans le
--    schéma : elle est donc maintenue ici, en SQL brut.
DROP INDEX "bookings_userId_serviceId_slotId_periodId_week_key";
CREATE UNIQUE INDEX "bookings_userId_serviceId_slotId_periodId_week_key"
  ON "bookings"("userId", "serviceId", "slotId", "periodId", "week") NULLS NOT DISTINCT;

-- 5) Vraie clé étrangère vers periods (suppression d'une période → cascade, cohérent avec
--    la cascade slot→booking déjà en place).
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
