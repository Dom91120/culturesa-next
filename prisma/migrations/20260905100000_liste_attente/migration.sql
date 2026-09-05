-- Liste d'attente (réglage PAR SERVICE, opt-in) : disponibilités par demi-journée d'un
-- usager + inscription automatique ; traitée par /api/cron/waiting-list.
ALTER TABLE "services" ADD COLUMN "listeAttente" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "liste_attente" (
  "id"              SERIAL PRIMARY KEY,
  "serviceId"       TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "disponibilites"  TEXT NOT NULL DEFAULT '',
  "autoInscription" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastNotifiedAt"  TIMESTAMPTZ,
  "notifiedKeys"    TEXT NOT NULL DEFAULT '',
  CONSTRAINT "liste_attente_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "liste_attente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "liste_attente_serviceId_userId_key" ON "liste_attente" ("serviceId", "userId");
CREATE INDEX "liste_attente_serviceId_createdAt_idx" ON "liste_attente" ("serviceId", "createdAt");

-- Déclencheurs d'e-mails (référentiel persisté ; le code les fusionne aussi au chargement).
INSERT INTO "mail_triggers" ("key", "label", "default_kind", "position") VALUES
  ('waitlist_join', 'L''usager s''inscrit sur la liste d''attente', 'waitlist_joined', 13),
  ('waitlist_available', 'Liste d''attente : des créneaux se sont libérés', 'waitlist_available', 14),
  ('waitlist_autobook', 'Liste d''attente : inscription automatique sur un créneau libéré', 'waitlist_autobooked', 15)
ON CONFLICT ("key") DO NOTHING;
