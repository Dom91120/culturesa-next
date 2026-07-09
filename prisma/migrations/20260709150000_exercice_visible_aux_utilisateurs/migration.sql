-- « Affiché aux utilisateurs » : l'UNIQUE exercice du service accessible côté usager.
-- Unicité par service maintenue par l'application (transaction dans periods.ts).
ALTER TABLE "exercice" ADD COLUMN "visibleToUsers" BOOLEAN NOT NULL DEFAULT false;

-- Initialisation : un exercice par service, en privilégiant celui qui porte des
-- périodes ACTIVES (comportement usager actuel : seules les périodes actives sont
-- affichées), sinon le plus récent (dateEnd la plus tardive).
UPDATE "exercice" SET "visibleToUsers" = true WHERE id IN (
  SELECT DISTINCT ON (e."serviceId") e.id
  FROM "exercice" e
  LEFT JOIN "periods" p ON p."exerciceId" = e.id AND p."state" = 'actif'
  WHERE e."serviceId" IS NOT NULL
  ORDER BY e."serviceId",
    (p.id IS NOT NULL) DESC,
    e."dateEnd" DESC NULLS LAST,
    e.id DESC
);
