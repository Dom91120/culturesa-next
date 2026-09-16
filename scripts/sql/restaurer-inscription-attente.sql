-- Remet un usager dans la liste d'attente d'un service À LA PLACE qu'il occupait, à partir
-- de sa ligne d'historique (liste_attente_historique), puis supprime cette ligne.
--
-- Cas d'usage (Dom 2026-09-16) : une inscription close dont l'issue n'a pas tenu — usager
-- inscrit automatiquement (AUTO_BOOKED) ou ayant réservé (BOOKED) dont la réservation a
-- ensuite été refusée / supprimée, ou inscription retirée par erreur (REMOVED, LEFT).
-- L'ordre de la file étant celui d'inscription (createdAt), on réinjecte l'entrée avec sa
-- date d'inscription d'origine (inscritAt), ses disponibilités, ses périodes et son choix
-- d'inscription automatique. Une ligne AUTO_BOOKED / BOOKED n'est restaurée que si sa
-- réservation n'existe plus (bookingId NULL) : l'usager ne peut pas être à la fois placé
-- et en attente.
-- Les créneaux déjà signalés (notifiedKeys) ne sont pas conservés dans l'historique :
-- la tâche planifiée pourra donc la prévenir à nouveau d'un créneau libre, ce qui est
-- souhaitable après une remise en file.
--
-- Usage, depuis le dossier du projet sur le serveur, APRÈS une sauvegarde :
--   docker compose exec --user 1001:1001 cron backup.sh
--   docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
--     -v email='prenom.nom@exemple.fr' -v svc='svc_002' \
--     < scripts/sql/restaurer-inscription-attente.sql
--
-- Le script AFFICHE d'abord les lignes d'historique de l'usager sur le service, puis
-- restaure la PLUS RÉCENTE restaurable (cf. ci-dessus). Il s'arrête sans rien écrire si :
-- l'usager est introuvable, aucune ligne ne convient, ou une entrée vivante existe déjà.
-- Tout est dans une transaction : en cas d'erreur, rien n'est modifié.
--
-- (psql ne substitue pas ses variables dans un bloc DO $$…$$ : elles passent par
-- set_config / current_setting.)

\set ON_ERROR_STOP on

\echo '── Historique de l''usager sur le service (toutes issues) ──'
SELECT h.id, h.issue, h."inscritAt", h."clotureAt", h.disponibilites, h."periodIds",
       h."autoInscription", h."bookingId", h."structureLabel"
FROM liste_attente_historique h
JOIN "user" u ON u.id = h."userId"
WHERE lower(u.email) = lower(:'email') AND h."serviceId" = :'svc'
ORDER BY h."clotureAt" DESC;

\echo '── Entrée vivante actuelle (doit être vide) ──'
SELECT e.id, e."createdAt", e.disponibilites, e."periodIds", e."autoInscription"
FROM liste_attente e
JOIN "user" u ON u.id = e."userId"
WHERE lower(u.email) = lower(:'email') AND e."serviceId" = :'svc';

BEGIN;

SELECT set_config('resto.email', :'email', true), set_config('resto.svc', :'svc', true);

DO $$
DECLARE
  v_email text := current_setting('resto.email');
  v_svc   text := current_setting('resto.svc');
  v_user_id text;
  v_log record;
BEGIN
  SELECT id INTO v_user_id FROM "user" WHERE lower(email) = lower(v_email);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usager introuvable : %', v_email;
  END IF;

  IF EXISTS (SELECT 1 FROM liste_attente WHERE "serviceId" = v_svc AND "userId" = v_user_id) THEN
    RAISE EXCEPTION 'Une inscription vivante existe déjà pour cet usager sur % — rien à restaurer', v_svc;
  END IF;

  SELECT * INTO v_log
  FROM liste_attente_historique
  WHERE "serviceId" = v_svc AND "userId" = v_user_id
    AND issue IN ('REMOVED', 'LEFT', 'AUTO_BOOKED', 'BOOKED')
    AND "bookingId" IS NULL
  ORDER BY "clotureAt" DESC
  LIMIT 1;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'Aucune ligne d''historique restaurable (REMOVED / LEFT / AUTO_BOOKED / BOOKED sans réservation vivante) pour cet usager sur %', v_svc;
  END IF;

  INSERT INTO liste_attente
    ("serviceId", "userId", disponibilites, "autoInscription", "createdAt", "updatedAt",
     "lastNotifiedAt", "notifiedKeys", "periodIds")
  VALUES
    (v_svc, v_user_id, v_log.disponibilites, v_log."autoInscription", v_log."inscritAt", now(),
     NULL, '', v_log."periodIds");

  DELETE FROM liste_attente_historique WHERE id = v_log.id;

  RAISE NOTICE 'Restauré : inscription du % (dispos « % », périodes « % », auto %) ; ligne d''historique % supprimée',
    v_log."inscritAt", v_log.disponibilites, v_log."periodIds", v_log."autoInscription", v_log.id;
END $$;

\echo '── File d''attente du service après restauration (ordre d''inscription) ──'
SELECT e.id, u.nom, u.prenom, e."createdAt", e.disponibilites, e."periodIds", e."autoInscription"
FROM liste_attente e
JOIN "user" u ON u.id = e."userId"
WHERE e."serviceId" = :'svc'
ORDER BY e."createdAt";

COMMIT;
