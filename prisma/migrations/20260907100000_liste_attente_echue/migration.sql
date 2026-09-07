-- Liste d'attente : inscription ÉCHUE (Dom 2026-09-07) — les périodes souhaitées sont
-- terminées sans qu'une place ait pu être proposée (clôture automatique par la tâche
-- planifiée « Liste d'attente », e-mail à l'usager). Nouvelle issue dans l'historique.
ALTER TYPE "WaitingListOutcome" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Déclencheur d'e-mail (référentiel persisté ; le code le fusionne aussi au chargement).
INSERT INTO "mail_triggers" ("key", "label", "default_kind", "position") VALUES
  ('waitlist_expire', 'Liste d''attente : inscription échue (périodes terminées)', 'waitlist_expired', 16)
ON CONFLICT ("key") DO NOTHING;
