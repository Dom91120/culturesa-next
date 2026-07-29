-- ════════════════════════════════════════════════════════════════════════════
--  Vérification du rôle applicatif — À EXÉCUTER CONNECTÉ AVEC CE RÔLE.
--
--  Ce script ne se contente pas de lire les attributs du rôle : il TENTE
--  réellement les opérations qui doivent échouer. Un durcissement se constate,
--  il ne se déduit pas d'une ligne de catalogue.
--
--  Utilisation :
--    psql "postgresql://culturesa_app:MOT_DE_PASSE@localhost:5432/culturesa" \
--         -f 02-verifier-role-applicatif.sql
--
--  Toute ligne « ✗ » signale un durcissement incomplet.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

\echo ''
\echo '── Identité de connexion ──'
SELECT current_user AS "connecté en tant que",
       current_database() AS "base",
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "superutilisateur";

\echo ''
\echo '── 1. Exécution de programmes sur le serveur (doit être REFUSÉE) ──'
DO $$
BEGIN
  EXECUTE $q$ COPY (SELECT 1) TO PROGRAM 'true' $q$;
  RAISE EXCEPTION '✗ ÉCHEC : COPY TO PROGRAM a RÉUSSI. Le rôle peut lancer des programmes sur le serveur.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '✓ COPY TO PROGRAM refusé (privilège insuffisant)';
END $$;

\echo ''
\echo '── 2. Lecture de fichiers du serveur (doit être REFUSÉE) ──'
DO $$
BEGIN
  EXECUTE $q$ COPY (SELECT 1) TO '/tmp/culturesa_test_privilege' $q$;
  RAISE EXCEPTION '✗ ÉCHEC : écriture de fichier serveur RÉUSSIE. Le rôle accède au système de fichiers.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '✓ Écriture de fichier serveur refusée (privilège insuffisant)';
END $$;

\echo ''
\echo '── 3. Appartenance aux rôles prédéfinis sensibles (doit être VIDE) ──'
SELECT r.rolname AS "rôle prédefini accordé — PROBLÈME"
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.roleid
JOIN pg_roles u ON u.oid = m.member
WHERE u.rolname = current_user
  AND r.rolname IN ('pg_execute_server_program', 'pg_read_server_files',
                    'pg_write_server_files', 'pg_read_all_data', 'pg_write_all_data');

\echo ''
\echo '── 4. Propriété des objets applicatifs (doit être 0) ──'
SELECT count(*) AS "objets NON possédés par le rôle — PROBLÈME"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'S', 'v', 'm', 'p')
  AND pg_get_userbyid(c.relowner) <> current_user;

SELECT count(*) AS "types NON possédés par le rôle — PROBLÈME"
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
  AND pg_get_userbyid(t.typowner) <> current_user;

\echo ''
\echo '── 5. Capacités RÉELLEMENT nécessaires à l''application (doivent RÉUSSIR) ──'
-- Ce qui précède vérifie ce qui doit être interdit ; ceci vérifie que l'on n'a
-- pas trop retiré. Un rôle durci mais incapable de migrer serait inutilisable.
DO $$
BEGIN
  CREATE TABLE public._culturesa_test_privilege (id int primary key, v text);
  INSERT INTO public._culturesa_test_privilege VALUES (1, 'test');
  CREATE INDEX _culturesa_test_idx ON public._culturesa_test_privilege (v);
  ALTER TABLE public._culturesa_test_privilege ADD COLUMN extra int;
  CREATE TYPE public._culturesa_test_enum AS ENUM ('a', 'b');
  ALTER TYPE public._culturesa_test_enum ADD VALUE 'c';
  RAISE NOTICE '✓ CREATE / ALTER TABLE, INDEX, TYPE : autorisés (migrations Prisma OK)';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '✗ ÉCHEC : le rôle ne peut pas migrer le schéma (%). Vérifiez la propriété du schéma public.', SQLERRM;
END $$;

-- Nettoyage des objets de test, hors du bloc précédent (ADD VALUE sur un enum
-- ne peut pas être suivi de sa suppression dans la même transaction).
DROP TABLE IF EXISTS public._culturesa_test_privilege;
DROP TYPE IF EXISTS public._culturesa_test_enum;

\echo ''
\echo '✓ Vérification terminée. Aucune ligne « PROBLÈME » ni « ✗ » ci-dessus = rôle conforme.'
