-- Catégorie « fourre-tout » : structure saisie librement par l'usager à l'inscription.
-- AlterTable
ALTER TABLE "demandeurs" ADD COLUMN "structureLibre" BOOLEAN NOT NULL DEFAULT false;

-- La catégorie « Autres », si elle existe, est le cas d'usage qui motive ce mode :
-- elle n'a pas de liste de structures et n'en aura pas. On l'active donc d'office,
-- pour que le comportement soit le même sur tous les environnements sans geste
-- d'administration. Le réglage reste modifiable depuis Configuration > Demandeurs.
UPDATE "demandeurs" SET "structureLibre" = true WHERE lower("label") = 'autres';
