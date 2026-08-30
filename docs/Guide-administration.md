# Guide d'administration — CultuRésa

Installation serveur, base de données, exploitation et **sauvegarde**.

Ce guide s'adresse à la personne qui installe et maintient CultuRésa sur un serveur.
Pour l'utilisation fonctionnelle (réservations, gestion des services), voir le
[Guide d'utilisation](Guide-utilisation.md).

---

## 1. Architecture

CultuRésa s'installe en **auto-hébergé** via Docker Compose. Trois conteneurs de service,
plus un conteneur d'initialisation ponctuel (`init`) :

| Conteneur | Rôle |
|-----------|------|
| **app** | Application Next.js (standalone) + Prisma — servie en HTTP sur le port **3000** |
| **db** | Base de données PostgreSQL 17 (volume persistant `pgdata`) |
| **cron** | Tâches planifiées (auto-validation, rappels, RGPD) **et sauvegarde quotidienne de la base** |
| **init** | One-shot (profil `init`, lancé à la demande) : crée le compte administrateur et les référentiels d'e-mails |

> La stack n'embarque **pas de reverse proxy** : pour une exposition à Internet, placer
> l'app derrière un proxy TLS externe (nginx, Traefik, Caddy hôte…) qui porte le
> certificat HTTPS et les en-têtes de sécurité.

Les migrations de base de données sont appliquées **automatiquement** au démarrage de
`app` (`prisma migrate deploy`).

---

## 2. Prérequis serveur

- Un serveur (VPS) avec **Docker** et le plugin **Compose** (`docker compose version`).
- Le port **3000** joignable par le reverse proxy externe (ou ouvert pour un usage LAN).
- Si exposition à Internet : un **nom de domaine** pointant vers le proxy, qui gère le TLS.

---

## 3. Configuration (`.env`)

La configuration se fait dans un fichier `.env` (copié depuis `.env.example`). **Ne jamais
committer le vrai `.env`** (il est déjà dans `.gitignore`).

| Variable | Rôle |
|----------|------|
| `APP_DOMAIN` | Domaine public de l'app (ex. `reservations.mon-asso.fr`), servi par le proxy externe |
| `APP_URL` | URL complète **vue par les navigateurs** (celle du proxy, ou `http://<hôte>:3000` en accès direct) |
| `ADMIN_EMAIL` | E-mail du compte administrateur (identifiant de connexion) |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | **Mot de passe fort** de la base |
| `POSTGRES_DB` | Nom de la base |
| `DATABASE_URL` | Construite automatiquement en Docker ; à renseigner seulement en dev local |
| `NEXT_PUBLIC_APP_URL` | URL publique exposée au navigateur (= `APP_URL` en général) |
| `BETTER_AUTH_SECRET` | Secret d'authentification (générer aléatoirement) |
| `TRUSTED_ORIGINS` | Origines supplémentaires de confiance (anti-CSRF), optionnel |
| `CRON_SECRET` | Secret partagé entre le conteneur cron et les routes `/api/cron` |
| `CAPTCHA_DISABLED` | `true` pour désactiver le CAPTCHA d'inscription (tests) ; sinon actif |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | **Optionnel** — repli d'envoi d'e-mails ; la configuration SMTP se fait normalement depuis l'admin (Messagerie), stockée en base |

Génération des secrets :

```bash
openssl rand -base64 32   # -> BETTER_AUTH_SECRET
openssl rand -hex 24      # -> CRON_SECRET
```

---

## 4. Installation pas à pas

```bash
# 1. Récupérer le code
git clone <ton-repo> culturesa && cd culturesa

# 2. Configurer l'environnement
cp .env.example .env
nano .env            # domaine, mots de passe, secrets, SMTP...

# 3. Construire et lancer toute la stack
docker compose up -d --build

# 4. Suivre le démarrage
docker compose logs -f app
```

Au démarrage, `docker-entrypoint.sh` applique les migrations Prisma puis lance le serveur.
L'app répond alors en HTTP sur `http://<hôte>:3000` ; le HTTPS, s'il y a lieu, est porté
par le reverse proxy externe.

> Pour un essai local sans domaine ni proxy : `APP_URL=http://localhost:3000` (et
> `NEXT_PUBLIC_APP_URL` identique).

---

## 5. Base de données

- **Moteur** : PostgreSQL 17, dans le conteneur `db`, données dans le volume Docker
  persistant `pgdata` (conservées même après `docker compose down`).
- **Migrations** : appliquées automatiquement au démarrage de `app`. Application manuelle
  possible : `docker compose exec app pnpm db:deploy`.
- **Données initiales (démo)** : `docker compose exec app pnpm db:seed` crée des données
  de démonstration et un compte administrateur de démo. ⚠️ **À n'utiliser qu'en
  initialisation/démo** : en production, changez immédiatement le mot de passe de ce
  compte (ou créez votre propre administrateur) et évitez de relancer le seed sur des
  données réelles.
- **Accès direct** (diagnostic) :

```bash
docker compose exec db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

---

## 6. Sauvegarde et restauration

### Sauvegarde automatique (planifiée)

L'application réalise un **dump automatique** — par défaut à **02h00**, planification
modifiable dans l'admin (Administration › Tâches planifiées › CRON) — via la route
`/api/cron/backup`, appelée toutes les 5 minutes par le conteneur `cron` :

- `pg_dump` complet, **compressé en gzip**, déposé dans **`./backups/`** sur l'hôte ;
- **rotation** : seuls les **7 dumps automatiques les plus récents** sont conservés
  (≈ une semaine) ; les plus anciens sont supprimés automatiquement.

```bash
# Lister les sauvegardes présentes
ls -lh backups/

# Vérifier que les appels du déclencheur partent
docker compose logs -f cron
```

Un dump immédiat se déclenche depuis l'admin : « Exécuter maintenant » (Tâches planifiées ›
CRON) ou « Créer un export maintenant » (Tâches planifiées › Exports).

> ⚠️ **Copie hors-site indispensable.** `./backups/` se trouve sur le même disque que la
> base : en cas de perte du serveur, les sauvegardes disparaissent avec lui. Planifiez une
> copie régulière de ce dossier vers un autre emplacement (rsync/scp, stockage objet S3,
> NAS…).

### Restauration

```bash
# Depuis un dump compressé du dossier backups/ (automatique culturesa-* ou manuel manuel-*)
gunzip -c backups/culturesa-AAAAMMJJ-HHMMSS.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# Depuis un dump .sql non compressé
cat backup.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

### Dump manuel ponctuel

```bash
docker compose exec --user 1001:1001 cron backup.sh
```

> Dump direct depuis Postgres (fonctionne même si le conteneur `app` est arrêté ;
> `--user 1001:1001` obligatoire — le conteneur durci n'autorise plus root à
> écrire dans `/backups`) → `backups/manuel-AAAAMMJJ-HHMMSS.sql.gz.aes`,
> **chiffré** avec `BACKUP_ENCRYPTION_KEY` au format openssl (différent du `.enc`
> de l'app), **invisible dans l'admin** et **jamais purgé** : restauration en
> ligne de commande uniquement, suppression à votre charge après usage.

Restauration d'un tel dump (avec la clé en vigueur au moment de sa création) :

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_ENCRYPTION_KEY -in backups/manuel-AAAAMMJJ-HHMMSS.sql.gz.aes | gunzip | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

> Régler l'horaire : directement dans l'admin (Tâches planifiées › CRON), pris en compte
> sans redéploiement. La durée de rétention (7 dumps automatiques) est fixée dans le code
> (`AUTO_RETAIN`, `src/server/services/backup.ts`).

---

## 7. Exploitation courante

```bash
docker compose ps                 # état des conteneurs
docker compose logs -f app        # logs applicatifs
docker compose restart app        # redémarrer l'app
docker compose down               # tout arrêter (données conservées)

# Mise à jour après récupération du code
git pull
docker compose up -d --build      # reconstruit et redéploie (migrations auto)
```

---

## 8. Points d'attention

- **Secrets** : utilisez des valeurs fortes et uniques pour `POSTGRES_PASSWORD`,
  `BETTER_AUTH_SECRET` et `CRON_SECRET`. Ne committez jamais le `.env`.
- **Sauvegardes** : vérifiez régulièrement que les dumps se créent (`ls backups/`) et
  **testez une restauration** de temps en temps — une sauvegarde jamais restaurée n'est
  pas une sauvegarde fiable.
- **Compte administrateur** : sécurisez/renommez le compte de démo avant la mise en
  production.
- **Réseau** : l'app est publiée en local (`127.0.0.1:3000`, conteneur non-root) ; les
  ports 80/443 relèvent du **proxy TLS externe** s'il y en a un (cf. §1).
