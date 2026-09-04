-- Absence PRÉVENUE À L'AVANCE sur une séance datée : horodatage + auteur du
-- signalement (usager / gestionnaire). Distinct du pointage (posé après coup) ;
-- le motif éventuel réutilise bookings.pointageMotif.
CREATE TYPE "AbsenceSource" AS ENUM ('usager', 'gestionnaire');

ALTER TABLE "bookings"
  ADD COLUMN "absencePrevenueAt"  TIMESTAMPTZ,
  ADD COLUMN "absencePrevenuePar" "AbsenceSource";

-- Déclencheurs d'e-mails du référentiel persisté (les serveurs déployés ne rejouent pas
-- le seed) : le code les fusionne aussi au chargement (listMailTriggers), ceci garde la
-- table fidèle. Type d'e-mail par défaut : « booking_absence » (gabarit intégré).
INSERT INTO "mail_triggers" ("key", "label", "default_kind", "position") VALUES
  ('absence_user', 'L''usager prévient d''une absence à une séance', 'booking_absence', 11),
  ('absence_manager', 'Le gestionnaire enregistre une absence prévenue', 'booking_absence', 12)
ON CONFLICT ("key") DO NOTHING;
