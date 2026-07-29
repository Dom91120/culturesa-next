# Bascule vers un rôle PostgreSQL applicatif non-superutilisateur

L'application n'a besoin que de lire et écrire ses propres objets. Se connecter avec le rôle d'amorçage de l'instance (superutilisateur) lui confère en plus l'accès au système de fichiers du serveur et l'exécution de programmes — capacités qu'elle n'utilise jamais, mais dont hérite tout SQL qu'elle exécute, y compris celui d'un dump restauré.

Ces deux scripts créent un rôle dédié et lui transfèrent la propriété du schéma.

| Fichier | Rôle |
|---|---|
| `01-creer-role-applicatif.sql` | crée le rôle, transfère la propriété des objets |
| `02-verifier-role-applicatif.sql` | **tente réellement** les opérations qui doivent échouer |

Le second ne se contente pas de lire des attributs de catalogue : il essaie `COPY … TO PROGRAM` et l'écriture de fichier serveur, et échoue bruyamment si elles réussissent. Un durcissement se constate, il ne se déduit pas.

## Ce que la bascule ne change pas

- **Les comptes applicatifs.** Un administrateur CultuRésa garde exactement les mêmes droits, restauration comprise. Le rôle PostgreSQL et le compte d'un utilisateur sont deux choses distinctes.
- **Les dumps existants.** Tous sont produits avec `--no-owner --no-privileges` (application et script de secours du conteneur cron), donc sans dépendance aux rôles de l'instance source.
- **Les migrations.** Vérifié : les 40 migrations s'appliquent depuis une base vide avec le rôle rétrogradé.

Un dump d'origine étrangère, produit sans ces options, pourrait en revanche échouer — ce qui est plutôt une bonne propriété.

## Prérequis

Aucune migration ne doit être en attente, et le schéma ne doit pas utiliser d'extension PostgreSQL (`CREATE EXTENSION` exige un superutilisateur). À la date de rédaction : aucune extension, aucune instruction privilégiée dans les 40 migrations.

## Procédure

> Les commandes ci-dessous utilisent `docker compose exec db`, qui désigne le **service** : elles fonctionnent quel que soit le nom du conteneur, lequel porte le préfixe du projet (`culturesa-db-1`) et varie d'un déploiement à l'autre.

### 1. Répéter sur une copie

Ne faites pas cette bascule directement en production.

`CREATE DATABASE … TEMPLATE` exigerait qu'aucune session ne soit ouverte sur la base source, donc l'arrêt de l'application. On passe par `pg_dump`, qui n'interrompt rien :

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS bascule_test" -c "CREATE DATABASE bascule_test"'
```

```bash
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges | psql -U "$POSTGRES_USER" -d bascule_test -q'
```

Les lignes `setval` en sortie sont normales (recalage des séquences). Vérifiez que la copie est fidèle en comparant le nombre de tables :

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d bascule_test -tAc "SELECT count(*) FROM pg_stat_user_tables"'
```

Déroulez les étapes 2 et 3 sur `bascule_test`, puis rejouez-les sur la base de production. C'est là qu'on découvre le détail qui manque.

### 2. Générer le mot de passe et créer le rôle

**En hexadécimal, pas en base64** : ce mot de passe finit dans une URL de connexion, et les `/` que produit `base64` la casseraient.

```bash
export APP_PW="$(openssl rand -hex 24)" && echo "généré, non affiché"
```

`export` est une primitive du shell : la valeur ne passe ni par l'historique ni par la ligne de commande d'un processus.

```bash
docker compose cp scripts/db/01-creer-role-applicatif.sql db:/tmp/01.sql
```

```bash
docker compose exec -e APP_PW db sh -c 'psql -U "$POSTGRES_USER" -d bascule_test -v app_role=culturesa_app -v app_password="$APP_PW" -f /tmp/01.sql'
```

`-e APP_PW` **sans valeur** transmet la variable par son nom : le mot de passe n'apparaît pas dans les arguments du conteneur.

Attendu en fin de sortie : `superutilisateur = f` et `objets encore possédés par un autre rôle = 0`.

> Les rôles PostgreSQL sont **globaux à l'instance**, pas propres à une base. Au passage en production, le script affichera donc `ALTER ROLE` sans `CREATE ROLE` — le rôle créé pendant la répétition existe déjà, et seul son mot de passe est réaligné. C'est le comportement idempotent attendu.

### 3. Vérifier, connecté avec le nouveau rôle

```bash
docker compose cp scripts/db/02-verifier-role-applicatif.sql db:/tmp/02.sql
```

```bash
docker compose exec -e APP_PW db sh -c 'PGPASSWORD="$APP_PW" psql -U culturesa_app -h 127.0.0.1 -d bascule_test -f /tmp/02.sql'
```

Aucune ligne `✗` ni `PROBLÈME` ne doit apparaître. Les cinq contrôles doivent passer, **y compris le cinquième** — celui qui vérifie qu'on n'a pas trop retiré et que les migrations restent possibles.

Puis rejouez le démarrage réel de l'application, qui applique les migrations à chaque lancement du conteneur :

```bash
export DATABASE_URL="postgresql://culturesa_app:$APP_PW@db:5432/bascule_test?schema=public"
```

```bash
docker compose run --rm -e DATABASE_URL --entrypoint node_modules/.bin/prisma app migrate deploy
```

```bash
unset DATABASE_URL
```

Attendu : `No pending migrations to apply.` sans erreur de permission.

### 4. Basculer la connexion de l'application

`docker-compose.yml` est déjà prêt : `DATABASE_URL` utilise `APP_DB_USER` / `APP_DB_PASSWORD` **avec repli sur `POSTGRES_*`**. Il n'y a rien à modifier dans le fichier — il suffit de renseigner les deux variables dans le `.env` de l'hôte :

```
APP_DB_USER=culturesa_app
APP_DB_PASSWORD=LE_MOT_DE_PASSE
```

Contrôlez la chaîne effectivement transmise avant de redémarrer — cette forme n'affiche **pas** le mot de passe :

```bash
docker compose config | grep -o 'postgresql://[^:]*:' | head -1
```

Elle doit afficher `postgresql://culturesa_app:`. Le service `db`, lui, continue d'utiliser `POSTGRES_USER` : le rôle d'amorçage reste intact, pour l'administration et le retour arrière.

```bash
docker compose up -d app
```

Les journaux doivent montrer `prisma migrate deploy` puis le démarrage sans erreur.

### 5. Vérifier en conditions réelles

Depuis l'interface : créer une sauvegarde, puis **la restaurer**. C'est le chemin qui utilise `pg_dump` et `psql` avec le nouveau rôle — le seul qui prouve que la bascule tient.

## Retour arrière

Retirer `APP_DB_USER` et `APP_DB_PASSWORD` du `.env` — la connexion se replie automatiquement sur le rôle d'amorçage — puis redémarrer :

```bash
docker compose up -d app
```

Le rôle d'amorçage n'a rien perdu ; la propriété des objets reste au rôle applicatif, ce qui ne le gêne en rien puisqu'il est superutilisateur. Aucune donnée n'est touchée par la bascule, aucun objet supprimé.

## Nettoyage après validation

Une fois la bascule confirmée en production, supprimer la base de répétition :

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS bascule_test"'
```

Retirez aussi les scripts du conteneur et le mot de passe de votre session :

```bash
docker compose exec db rm -f /tmp/01.sql /tmp/02.sql && unset APP_PW
```

Enfin, refermez les droits du dossier de sauvegardes s'il est encore en `755` :

```bash
sudo chgrp "$(id -gn)" backups && sudo chmod 2750 backups && sudo chmod 640 backups/*
```

Le bit `setgid` (le `2` de `2750`) fait hériter les nouveaux fichiers du groupe du dossier au lieu de celui du conteneur — sans quoi chaque sauvegarde redeviendrait illisible depuis l'hôte.

## Barrière complémentaire, déjà en place

`src/server/services/backup-guard.ts` inspecte le contenu de tout dump **avant** de le passer à `psql`, et refuse les instructions qu'une sauvegarde applicative ne produit jamais : `COPY … FROM/TO PROGRAM`, `CREATE EXTENSION`, `ALTER SYSTEM`, blocs `DO`, accès aux fichiers du serveur, création de rôle superutilisateur…

L'analyse est structurelle et non textuelle : les blocs de données (`COPY … FROM stdin;` … `\.`) sont isolés avant examen, faute de quoi un champ libre contenant « CREATE EXTENSION » ferait rejeter une sauvegarde parfaitement valide.

⚠️ **C'est un filtre par liste noire, donc contournable par nature.** Il agit en défense en profondeur et couvre la période antérieure à la bascule. Il ne remplace pas le rôle non-superutilisateur, qui supprime la *capacité* au lieu d'en reconnaître les usages.

## Reste à faire

**Exiger une ré-authentification** avant les opérations destructrices (restauration, suppression de service, anonymisation en masse). `freshAge` est déjà posé dans `src/server/session-policy.ts` — c'est le constat BAC3.
