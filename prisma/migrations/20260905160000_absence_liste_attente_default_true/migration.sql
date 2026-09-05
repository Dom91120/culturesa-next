-- « Absences prévenues » et « Liste d'attente » ACTIVÉES par défaut (Dom 2026-09-05) :
-- nouveau défaut de colonne + activation sur les services existants.
ALTER TABLE "services" ALTER COLUMN "absencePrevenue" SET DEFAULT true;
ALTER TABLE "services" ALTER COLUMN "listeAttente" SET DEFAULT true;
UPDATE "services" SET "absencePrevenue" = true, "listeAttente" = true;
