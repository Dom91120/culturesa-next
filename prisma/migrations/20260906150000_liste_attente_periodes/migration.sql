-- Liste d'attente : choix des PÉRIODES acceptées par l'usager (ids CSV ; vide = toutes les
-- périodes de l'exercice), sur l'entrée vivante et dans l'historique.
ALTER TABLE "liste_attente" ADD COLUMN "periodIds" TEXT NOT NULL DEFAULT '';
ALTER TABLE "liste_attente_historique" ADD COLUMN "periodIds" TEXT NOT NULL DEFAULT '';
