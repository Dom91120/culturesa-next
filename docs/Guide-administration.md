# Guide d'administration — CultuRésa

Installation serveur, base de données, exploitation et **sauvegarde**.

Ce guide s'adresse à la personne qui installe et maintient CultuRésa sur un serveur.
Pour l'utilisation fonctionnelle (réservations, gestion des services), voir le
*Guide d'utilisation*.

---

## 1. Architecture

CultuRésa s'installe en **auto-hébergé** via Docker Compose. Quatre conteneurs :

| Conteneur | Rôle |
|-----------|------|
| **app** | Application Next.js (standalone) + Prisma |
| **db** | Base de données PostgreSQL 17 (volume persistant `pgdata`) |
| **caddy** | Reverse proxy + HTTPS automatique (Let's Encrypt) |
| **cron** | Tâches planifiées (auto-validation, rappels, RGPD) **et sauvegarde quotidienne de la base** |

Les migrations de base de données sont appliquées **automatiquement** au démarrage de
`app` (`prisma migrate deploy`).

---

## 2. Prérequis serveur

- Un serveur (VPS) avec **Docker** et le plugin **Compose** (`docker compose version`).
- Les ports **80** et **443** ouverts (pare-feu) — HTTP/3 utilise aussi `443/udp`.
- Un **nom de domaine** dont l'enregistrement DNS (A / AAAA) pointe vers l'IP du serveur.

---

## 3. Configuration (`.env`)

La configuration se fait dans un fichier `.env` (copié depuis `.env.example`). **Ne jamais
committer le vrai `.env`** (il est déjà dans `.gitignore`).

| Variable | Rôle |
|----------|------|
| `APP_DOMAIN` | Domaine public servi par Caddy (ex. `reservations.mon-asso.fr`) |
| `APP_URL` | URL complète de l'app (doit correspondre au domaine) |
| `ADMIN_EMAIL` | E-mail pour les certificats Let's Encrypt |
| `POSTGRES_USER` | Utilisateur PostgreSQL |
| `POSTGRES_PASSWORD` | **Mot de passe fort** de la base |
| `POSTGRES_DB` | Nom de la base |
| `DATABASE_URL` | Construite automatiquement en Docker ; à renseigner seulement en dev local |
| `NEXT_PUBLIC_APP_URL` | URL publique exposée au navigateur (= `APP_URL` en général) |
| `BETTER_AUTH_SECRET` | Secret d'authentification (générer aléatoirement) |
| `TRUSTED_ORIGINS` | Origines supplémentaires de confiance (anti-CSRF), optionnel |
| `CRON_SECRET` | Secret partagé entre le conteneur cron et les routes `/api/cron` |
| `CAPTCHA_DISABLED` | `true` pour désactiver le CAPTCHA d'inscription (tests) ; sinon actif |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | Envoi des e-mails (Nodemailer) |

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
Une fois `app` démarré et le DNS propagé, Caddy obtient automatiquement le certificat HTTPS.

> Pour un essai local sans domaine : `APP_DOMAIN=localhost` (Caddy génère un certificat
> interne auto-signé).

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

### Sauvegarde automatique (quotidienne)

Le conteneur `cron` réalise un **dump quotidien à 02h00** (script `cron/backup.sh`,
planifié dans `cron/crontab`) :

- `pg_dump` complet, **compressé en gzip**, déposé dans **`./backups/`** sur l'hôte ;
- **rotation** : seuls les **7 dumps les plus récents** sont conservés (≈ une semaine) ;
  les plus anciens sont supprimés automatiquement.

```bash
# Lister les sauvegardes présentes
ls -lh backups/

# Suivre l'exécution du job (sortie visible dans les logs du conteneur)
docker compose logs -f cron

# Déclencher un dump immédiat, hors planification
docker compose exec cron /usr/local/bin/backup.sh
```

> ⚠️ **Copie hors-site indispensable.** `./backups/` se trouve sur le même disque que la
> base : en cas de perte du serveur, les sauvegardes disparaissent avec lui. Planifiez une
> copie régulière de ce dossier vers un autre emplacement (rsync/scp, stockage objet S3,
> NAS…).

### Restauration

```bash
# Depuis un dump compressé du conteneur cron
gunzip -c backups/culturesa-AAAAMMJJ-HHMMSS.sql.gz \
  | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# Depuis un dump .sql non compressé
cat backup.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

### Dump manuel ponctuel

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql
```

> Régler l'horaire ou la durée de rétention : modifier la ligne de sauvegarde dans
> `cron/crontab` (heure) et la variable `RETAIN` dans `cron/backup.sh` (nombre de dumps
> conservés), puis reconstruire le conteneur : `docker compose up -d --build cron`.

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
- **Réseau** : ports 80 et 443 (TCP) et 443 (UDP, HTTP/3) ouverts ; le conteneur `app`
  tourne en utilisateur non-root.
