-- Thème obligatoire, par service × demandeur : l'usager ne peut pas enregistrer sans
-- l'avoir renseigné. Additive et à false : le comportement existant ne change pas.
-- AlterTable
ALTER TABLE "service_demandeur_settings"
  ADD COLUMN "themeRequired" BOOLEAN NOT NULL DEFAULT false;
