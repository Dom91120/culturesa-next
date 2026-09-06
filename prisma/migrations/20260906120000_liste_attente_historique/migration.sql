-- Historique des inscriptions en liste d'attente : une ligne par entrée CLÔTURÉE
-- (inscription automatique, réservation faite par l'usager, retrait usager / gestionnaire,
-- anonymisation). Catégorie et structure figées à la clôture ; userId mis à NULL à
-- l'anonymisation (les libellés figés restent pour les statistiques).
CREATE TYPE "WaitingListOutcome" AS ENUM ('AUTO_BOOKED', 'BOOKED', 'LEFT', 'REMOVED', 'ANONYMIZED');

CREATE TABLE "liste_attente_historique" (
  "id"              SERIAL PRIMARY KEY,
  "serviceId"       TEXT NOT NULL,
  "userId"          TEXT,
  "demandeurLabel"  TEXT NOT NULL DEFAULT '',
  "structureLabel"  TEXT NOT NULL DEFAULT '',
  "disponibilites"  TEXT NOT NULL DEFAULT '',
  "autoInscription" BOOLEAN NOT NULL DEFAULT false,
  "inscritAt"       TIMESTAMPTZ NOT NULL,
  "clotureAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issue"           "WaitingListOutcome" NOT NULL,
  "bookingId"       INTEGER,
  CONSTRAINT "liste_attente_historique_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "liste_attente_historique_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "liste_attente_historique_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "liste_attente_historique_serviceId_inscritAt_idx" ON "liste_attente_historique" ("serviceId", "inscritAt");
CREATE INDEX "liste_attente_historique_userId_idx" ON "liste_attente_historique" ("userId");
CREATE INDEX "liste_attente_historique_bookingId_idx" ON "liste_attente_historique" ("bookingId");
