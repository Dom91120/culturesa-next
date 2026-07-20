-- « Délai limite de réservation » : déplacé du SERVICE vers l'EXERCICE (par exercice).
-- 1) Nouvelle colonne sur l'exercice (défaut 0 = aucun délai).
ALTER TABLE "exercice" ADD COLUMN "bookingDelay" INTEGER NOT NULL DEFAULT 0;

-- 2) Reprise de l'ancienne valeur du service dans CHACUN de ses exercices, pour préserver
--    le comportement existant (tous les exercices héritent du délai service courant).
UPDATE "exercice" e SET "bookingDelay" = s."bookingDelay"
FROM "services" s
WHERE e."serviceId" = s.id;

-- 3) Suppression de la colonne service (le service ne porte plus ce réglage).
ALTER TABLE "services" DROP COLUMN "bookingDelay";
