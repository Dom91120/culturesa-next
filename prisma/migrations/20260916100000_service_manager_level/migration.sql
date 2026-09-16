-- Niveau de droit d'un gestionnaire sur un service (Dom 2026-09-16) : `gestion` (tout,
-- valeur des rattachements existants) ou `consultation` (agenda, éditions et statistiques
-- en lecture seule). Additif : aucune ligne existante ne change de sens.
CREATE TYPE "ManagerLevel" AS ENUM ('gestion', 'consultation');

ALTER TABLE "service_manager"
  ADD COLUMN "level" "ManagerLevel" NOT NULL DEFAULT 'gestion';
