-- Snapshot structure / catégorie (demandeur) / niveau de l'usager sur la réservation
-- (même principe que themeLabel) : posé à la création, il fige la répartition des
-- statistiques — un changement de fiche usager (Mon compte, admin) ne réécrit plus
-- l'historique des exercices passés.
ALTER TABLE "bookings"
  ADD COLUMN "structureLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "demandeurLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "niveauLabel" TEXT NOT NULL DEFAULT '';

-- Backfill des réservations existantes depuis la fiche usager COURANTE : meilleure
-- approximation disponible (l'app n'a jamais historisé ces champs).
UPDATE "bookings" b
SET "structureLabel" = COALESCE(s."label", ''),
    "demandeurLabel" = COALESCE(d."label", ''),
    "niveauLabel"    = TRIM(u."niveau")
FROM "user" u
LEFT JOIN "structures" s ON s."id" = u."structureId"
LEFT JOIN "demandeurs" d ON d."id" = u."demandeurId"
WHERE u."id" = b."userId";
