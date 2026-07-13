-- Le mode « récurrent » et l'alternance Semaine A/B deviennent des réglages
-- GLOBAUX du service (Paramètres > Configuration), au lieu d'être portés par
-- chaque ligne de la matrice service × demandeurs :
--   - le type d'une réservation découle du TYPE DU CRÉNEAU (recurring/unique),
--     plus du mode du demandeur — la colonne « Mode » n'avait plus d'effet
--     par-demandeur (seul son agrégat service comptait) ;
--   - services.recurrentMode pilote la vue « Modèle de période » de l'agenda
--     admin ; services.semaineAb (colonne existante, jusqu'ici ignorée au
--     profit de la matrice) pilote l'alternance A/B, sans effet si
--     recurrentMode est désactivé.
-- Backfill de continuité : valeurs dérivées de la matrice actuelle (mêmes
-- agrégats que l'ancien deriveServiceModes), y compris services.semaineAb
-- (écrasé : sa valeur historique n'était pas consommée).
ALTER TABLE "services" ADD COLUMN "recurrentMode" BOOLEAN NOT NULL DEFAULT true;

UPDATE "services" s SET "recurrentMode" = EXISTS (
  SELECT 1 FROM "service_demandeur_settings" d
  WHERE d."serviceId" = s."id" AND d."recurrent"
);

UPDATE "services" s SET "semaineAb" = EXISTS (
  SELECT 1 FROM "service_demandeur_settings" d
  WHERE d."serviceId" = s."id" AND d."semaineAb"
);

ALTER TABLE "service_demandeur_settings" DROP COLUMN "recurrent";
ALTER TABLE "service_demandeur_settings" DROP COLUMN "semaineAb";
