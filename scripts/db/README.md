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

### 1. Répéter sur une copie

Ne faites pas cette bascule directement en production. Sur une base jetable :

```bash
docker exec culturesa-db psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE bascule_test TEMPLATE $POSTGRES_DB;"
```

Déroulez les étapes 2 à 4 dessus, puis supprimez-la. C'est là qu'on découvre le détail qui manque.

### 2. Générer le mot de passe et créer le rôle

```bash
openssl rand -base64 24
```

Le mot de passe n'est pas écrit dans le script : il est passé en variable.

```bash
docker cp scripts/db/01-creer-role-applicatif.sql culturesa-db:/tmp/01.sql
```

```bash
docker exec culturesa-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_role=culturesa_app -v app_password='LE_MOT_DE_PASSE' -f /tmp/01.sql
```

Attendu en fin de sortie : `superutilisateur = f` et `objets encore possédés par un autre rôle = 0`.

### 3. Vérifier, connecté avec le nouveau rôle

```bash
docker cp scripts/db/02-verifier-role-applicatif.sql culturesa-db:/tmp/02.sql
```

```bash
docker exec -e PGPASSWORD='LE_MOT_DE_PASSE' culturesa-db psql -U culturesa_app -h 127.0.0.1 \
  -d "$POSTGRES_DB" -f /tmp/02.sql
```

Aucune ligne `✗` ni `PROBLÈME` ne doit apparaître. Les cinq contrôles doivent passer, **y compris le cinquième** — celui qui vérifie qu'on n'a pas trop retiré et que les migrations restent possibles.

### 4. Basculer la connexion de l'application

Dans le `.env` de l'hôte :

```
APP_DB_USER=culturesa_app
APP_DB_PASSWORD=LE_MOT_DE_PASSE
```

Puis dans `docker-compose.yml`, service `app` :

```yaml
DATABASE_URL: postgresql://${APP_DB_USER}:${APP_DB_PASSWORD}@db:5432/${POSTGRES_DB}?schema=public
```

Le service `db` continue d'utiliser `POSTGRES_USER` : le rôle d'amorçage reste intact, pour les opérations d'administration et le retour arrière.

```bash
docker compose up -d app
```

Les journaux doivent montrer `prisma migrate deploy` puis le démarrage sans erreur.

### 5. Vérifier en conditions réelles

Depuis l'interface : créer une sauvegarde, puis **la restaurer**. C'est le chemin qui utilise `pg_dump` et `psql` avec le nouveau rôle — le seul qui prouve que la bascule tient.

## Retour arrière

Remettre l'ancienne `DATABASE_URL` et redémarrer :

```bash
docker compose up -d app
```

Le rôle d'amorçage n'a rien perdu ; la propriété des objets reste au rôle applicatif, ce qui ne le gêne en rien puisqu'il est superutilisateur. Aucune donnée n'est touchée par la bascule, aucun objet supprimé.

## Nettoyage après validation

Une fois la bascule confirmée en production, supprimer la base de répétition :

```bash
docker exec culturesa-db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE bascule_test;"
```

## Reste à faire

Le rôle non-superutilisateur ferme la capacité de sortir de la base. Deux mesures complémentaires, non couvertes ici :

- **contrôler le contenu d'un dump avant restauration** (rejet de `COPY … FROM PROGRAM`, `CREATE EXTENSION`, `DO $$`) — filtre par liste noire, contournable, donc complément et non substitut ;
- **exiger une ré-authentification** avant les opérations destructrices (restauration, suppression de service, anonymisation en masse). `freshAge` est déjà posé dans `src/server/session-policy.ts`.
