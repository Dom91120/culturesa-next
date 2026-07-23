-- Réglages du mode « Création de créneau » de l'agenda, mémorisés d'une visite à l'autre :
-- type de créneau, portée Semaine A/B, jauge et demandeurs autorisés par défaut. Défauts
-- identiques au comportement actuel (ponctuel, hors A/B, sans jauge, ouvert à tous), donc
-- aucun service existant ne change de comportement à la migration.
ALTER TABLE "services"
  ADD COLUMN "createKind" TEXT NOT NULL DEFAULT 'uniq',
  ADD COLUMN "createParityScoped" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "createJauge" BOOLEAN NOT NULL DEFAULT false,
  -- Pas de FK possible sur un tableau : les ids de demandeurs supprimés depuis sont
  -- filtrés à la lecture (cf. agenda/page.tsx).
  ADD COLUMN "createDemandeurIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
