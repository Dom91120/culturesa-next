-- ════════════════════════════════════════════════════════════════════════════
--  Rôle PostgreSQL dédié à l'application, SANS privilège superutilisateur.
--
--  Pourquoi : l'application ne doit pas se connecter avec le rôle d'amorçage de
--  l'instance, qui est superutilisateur. Elle restaure des dumps — donc exécute
--  du SQL venu de l'extérieur — et n'a besoin que de lire et écrire ses propres
--  objets. Un rôle superutilisateur lui conférerait en plus l'accès au système
--  de fichiers du serveur et l'exécution de programmes (COPY … FROM/TO PROGRAM),
--  c'est-à-dire la capacité de sortir de la base. Moindre privilège : on retire
--  cette capacité sans rien enlever à l'usage normal.
--
--  Ce que fait ce script :
--    1. crée le rôle applicatif (LOGIN, non superutilisateur) ;
--    2. lui transfère la propriété du schéma `public` et de tous ses objets —
--       nécessaire pour que `prisma migrate deploy` (CREATE/ALTER/DROP) et la
--       restauration (`pg_dump --clean` génère des DROP) continuent de passer ;
--    3. vérifie qu'aucun privilège dangereux ne lui a été accordé.
--
--  Le rôle d'amorçage reste inchangé et conserve tous ses droits : la bascule
--  se fait en modifiant DATABASE_URL, et se défait en la remettant. Aucun objet
--  n'est supprimé, aucune donnée n'est touchée.
--
--  Idempotent : réexécutable sans dommage.
--
--  Utilisation (le mot de passe n'est PAS écrit dans ce fichier) :
--    psql -v app_role=culturesa_app -v app_password='…' -f 01-creer-role-applicatif.sql
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- Sans ces variables, psql laisse `:'app_password'` littéral et l'échec se
-- manifeste par une « syntax error at or near ":" » qui n'aide personne.
\if :{?app_role}
\else
  \echo 'ERREUR : variable app_role manquante.'
  \echo 'Usage : psql -v app_role=culturesa_app -v app_password=... -f 01-creer-role-applicatif.sql'
  \quit
\endif
\if :{?app_password}
\else
  \echo 'ERREUR : variable app_password manquante.'
  \echo 'Usage : psql -v app_role=culturesa_app -v app_password=... -f 01-creer-role-applicatif.sql'
  \quit
\endif

\echo '→ 1/5 Création du rôle applicatif (si absent)'

-- `\gexec` exécute la requête produite : permet un CREATE ROLE conditionnel,
-- PostgreSQL n'ayant pas de « CREATE ROLE IF NOT EXISTS ».
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

-- Mot de passe réaligné à chaque exécution (rejeu du script après rotation).
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
\gexec

-- Garde-fous explicites. NOSUPERUSER/NOCREATEROLE/NOBYPASSRLS sont déjà les
-- valeurs par défaut : on les réaffirme pour que le script reste correct même
-- si le rôle préexistait avec d'autres attributs.
SELECT format('ALTER ROLE %I NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOREPLICATION',
              :'app_role')
\gexec

\echo '→ 2/5 Retrait des rôles prédéfinis sensibles (au cas où)'

-- Ces rôles prédéfinis rendraient le durcissement inopérant : ils redonnent
-- précisément l'accès au système de fichiers et à l'exécution de programmes.
-- On ne révoque QUE si l'appartenance existe réellement : un REVOKE à vide est
-- sans effet, mais PostgreSQL 16+ émet alors un WARNING par rôle, qui donne à
-- tort l'impression d'un problème pendant la bascule.
SELECT format('REVOKE %I FROM %I', r.rolname, :'app_role')
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.roleid
JOIN pg_roles u ON u.oid = m.member
WHERE u.rolname = :'app_role'
  AND r.rolname IN ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files')
\gexec

\echo '→ 3/5 Propriété du schéma public'

-- Posséder le schéma vaut droit d'y créer : c'est ce qui permet aux migrations
-- Prisma de continuer à créer et modifier des objets.
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_role')
\gexec

-- La propriété de la BASE n'est volontairement PAS transférée : elle
-- permettrait au rôle de supprimer la base entière, ce dont l'application n'a
-- aucun besoin. Posséder le schéma suffit.

\echo '→ 4/5 Transfert de la propriété des objets existants'

-- REASSIGN OWNED BY <superutilisateur> n'est délibérément PAS utilisé : il
-- toucherait aussi des objets système appartenant au rôle d'amorçage. On cible
-- donc explicitement les objets du schéma applicatif.

-- Tables (y compris _prisma_migrations : sans elle, migrate deploy échouerait).
SELECT format('ALTER TABLE public.%I OWNER TO %I', tablename, :'app_role')
FROM pg_tables WHERE schemaname = 'public'
\gexec

-- Séquences (identités des clés primaires).
SELECT format('ALTER SEQUENCE public.%I OWNER TO %I', sequencename, :'app_role')
FROM pg_sequences WHERE schemaname = 'public'
\gexec

-- Vues, s'il en existe.
SELECT format('ALTER VIEW public.%I OWNER TO %I', viewname, :'app_role')
FROM pg_views WHERE schemaname = 'public'
\gexec

-- Types énumérés et domaines (Role, BookingType, DayOfWeek, …). Sans ce
-- transfert, une migration modifiant un enum (ALTER TYPE … ADD VALUE) échouerait.
SELECT format('ALTER TYPE public.%I OWNER TO %I', t.typname, :'app_role')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
\gexec

-- Fonctions et procédures éventuelles.
SELECT format('ALTER ROUTINE public.%I(%s) OWNER TO %I',
              p.proname, pg_get_function_identity_arguments(p.oid), :'app_role')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
\gexec

\echo '→ 5/5 Contrôle immédiat'

-- Échoue bruyamment si le rôle est resté superutilisateur : mieux vaut une
-- erreur ici qu'un durcissement qu'on croit appliqué et qui ne l'est pas.
-- Le bloc est GÉNÉRÉ puis exécuté (\gexec) : une variable psql ne peut pas être
-- lue depuis l'intérieur d'un DO, qui est une simple chaîne pour le serveur.
SELECT format($gen$
DO $blk$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L AND rolsuper) THEN
    RAISE EXCEPTION 'Le rôle applicatif est SUPERUSER : le durcissement est sans effet.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
    RAISE EXCEPTION 'Le rôle applicatif est introuvable : la création a échoué.';
  END IF;
END $blk$;
$gen$, :'app_role', :'app_role')
\gexec

SELECT rolname AS "rôle",
       rolsuper AS "superutilisateur",
       rolcreatedb AS "peut créer des bases",
       rolcreaterole AS "peut créer des rôles"
FROM pg_roles WHERE rolname = :'app_role';

-- Tables, séquences, vues… ET types : les types énuméré étaient absents de ce
-- contrôle, alors qu'un enum resté à l'ancien propriétaire ferait échouer toute
-- migration le modifiant (ALTER TYPE … ADD VALUE).
SELECT count(*) AS "objets encore possédés par un autre rôle"
FROM (
  SELECT c.relowner AS owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v', 'm', 'p')
  UNION ALL
  SELECT t.typowner
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
) o
WHERE pg_get_userbyid(o.owner) <> :'app_role';

\echo ''
\echo '✓ Terminé. Lancez 02-verifier-role-applicatif.sql EN VOUS CONNECTANT AVEC LE NOUVEAU RÔLE.'
