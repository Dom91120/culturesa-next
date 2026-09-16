-- Supprime de l'historique de la liste d'attente (liste_attente_historique) TOUTES les
-- lignes d'un usager sur un service, SANS le remettre en file d'attente.
--
-- Cas d'usage (Dom 2026-09-16) : lignes laissées par un compte de test, qui faussent les
-- statistiques « sans place » et l'édition Historique. Ne touche ni aux réservations ni
-- à l'entrée vivante de la liste d'attente (liste_attente), s'il y en a une.
--
-- Usage, depuis le dossier du projet sur le serveur, APRÈS une sauvegarde :
--   docker compose exec --user 1001:1001 cron backup.sh
--   docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
--     -v email='compte.test@exemple.fr' -v svc='svc_002' \
--     < scripts/sql/supprimer-historique-attente.sql
--
-- Le script AFFICHE les lignes visées, puis les supprime dans une transaction. Il
-- s'arrête sans rien écrire si l'usager est introuvable ou s'il n'y a aucune ligne.

\set ON_ERROR_STOP on

\echo '── Lignes d''historique qui seront supprimées ──'
SELECT h.id, h.issue, h."inscritAt", h."clotureAt", h.disponibilites, h."periodIds",
       h."autoInscription", h."bookingId", h."creneauLabel", h."structureLabel"
FROM liste_attente_historique h
JOIN "user" u ON u.id = h."userId"
WHERE lower(u.email) = lower(:'email') AND h."serviceId" = :'svc'
ORDER BY h."clotureAt";

BEGIN;

SELECT set_config('purge.email', :'email', true), set_config('purge.svc', :'svc', true);

DO $$
DECLARE
  v_email text := current_setting('purge.email');
  v_svc   text := current_setting('purge.svc');
  v_user_id text;
  v_n integer;
BEGIN
  SELECT id INTO v_user_id FROM "user" WHERE lower(email) = lower(v_email);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usager introuvable : %', v_email;
  END IF;

  DELETE FROM liste_attente_historique WHERE "serviceId" = v_svc AND "userId" = v_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Aucune ligne d''historique pour cet usager sur %', v_svc;
  END IF;
  RAISE NOTICE '% ligne(s) d''historique supprimée(s) pour % sur %', v_n, v_email, v_svc;
END $$;

\echo '── Historique restant du service ──'
SELECT h.id, u.nom, u.prenom, h.issue, h."inscritAt", h."clotureAt"
FROM liste_attente_historique h
LEFT JOIN "user" u ON u.id = h."userId"
WHERE h."serviceId" = :'svc'
ORDER BY h."clotureAt";

COMMIT;
