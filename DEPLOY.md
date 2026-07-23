# Déploiement — CultuRésa (Next.js auto-hébergé)

Stack de prod : **Next.js standalone** + **PostgreSQL 17**, orchestrés par Docker Compose.
L'app est publiée en **HTTP sur le port 3000** ; le TLS et les en-têtes de sécurité relèvent
d'un **reverse proxy externe** à la stack (nginx, Traefik, Caddy hôte…) si elle est exposée à Internet.

> 📘 Ce document couvre l'**installation** et les opérations de base. Pour l'**exploitation au
> quotidien** (supervision, durcissement, sauvegarde hors-site, test de restauration, dépannage),
> voir le runbook **[docs/EXPLOITATION.md](docs/EXPLOITATION.md)**.

## Prérequis sur le VPS
- **OS** : Linux 64 bits récent (Debian 12 / Ubuntu 22.04+ recommandés).
- **Docker Engine ≥ 24** + plugin Compose v2 (`docker compose version`).
- **Dimensionnement minimal** : 2 vCPU, 2 Go RAM, 20 Go SSD. **Recommandé** : 2 vCPU, 4 Go RAM,
  40 Go SSD (le build de l'image Next.js et PostgreSQL sont les postes les plus gourmands ;
  prévoir de la marge disque pour `pgdata` + `./backups`).
- Port **3000** joignable par le reverse proxy externe (ou ouvert directement pour un usage LAN).
- Si exposition à Internet : un nom de domaine pointant (enregistrement A/AAAA) vers l'IP du
  proxy, et le TLS géré par celui-ci.

## Mise en route — installation automatisée (recommandé)

Sur un serveur vierge, le script `scripts/install.sh` fait tout : génération des
secrets dans `.env`, build et démarrage de la stack, migrations Prisma, puis
**initialisation d'une base vierge avec UNIQUEMENT le compte administrateur**.

```bash
# 1. Récupérer le code
git clone <ton-repo> culturesa && cd culturesa

# 2. Lancer l'installation (interactif : domaine, e-mail admin, mot de passe)
./scripts/install.sh
```

Le script est **idempotent** (relançable). Il :
- crée `.env` depuis `.env.example` et génère `BETTER_AUTH_SECRET`, `CRON_SECRET`,
  `POSTGRES_PASSWORD` (les valeurs déjà renseignées sont conservées) ;
- demande le **domaine**, l'**e-mail admin** (= identifiant de connexion) et le
  **mot de passe admin** (généré et affiché si non fourni) ;
- construit et démarre `app + db + cron`, applique les migrations, puis
  crée le compte admin et les référentiels système d'e-mails (`db:init`).

En non-interactif (CI) : `APP_DOMAIN=… ADMIN_EMAIL=… ADMIN_PASSWORD=… ./scripts/install.sh`.

> ⚠️ Le seed d'installation ne crée **aucune** donnée métier (demandeurs,
> structures, niveaux, vacances, services, créneaux). Tout cela se configure
> ensuite depuis l'interface d'administration.

### Mise en route manuelle (équivalent)

```bash
cp .env.example .env
nano .env                       # domaine, mots de passe, ADMIN_EMAIL/ADMIN_PASSWORD
openssl rand -base64 32         # -> BETTER_AUTH_SECRET
openssl rand -hex 24            # -> CRON_SECRET

# Dossier des dumps, AVANT le premier "up" (sinon Docker le crée en root:root et
# l'app, qui tourne en UID 1001, ne peut plus y écrire) :
mkdir -p backups && sudo chown 1001:1001 backups

docker compose up -d --build    # build + démarrage (migrations jouées à l'entrypoint)
docker compose run --rm init    # crée le compte admin + référentiels e-mails (db:init)
docker compose logs -f app
```

Au démarrage, `docker-entrypoint.sh` applique automatiquement les migrations
Prisma (`prisma migrate deploy`), puis lance le serveur Node.

> Le dossier `./backups` doit appartenir à **1001:1001** (utilisateur `nextjs` de
> l'image) : c'est lui que le conteneur `app` utilise pour la sauvegarde manuelle,
> le téléversement et la suppression de dumps (onglet admin « Sauvegardes »). Le
> conteneur `cron` tourne en root et écrit dans tous les cas. `scripts/install.sh`
> s'en charge automatiquement.

### Données de démonstration (optionnel, hors prod)

Pour un jeu de démo complet (services, créneaux, usagers fictifs, réservations) à
la place de l'init minimal :

```bash
docker compose run --rm init pnpm db:seed
```

## Opérations courantes

```bash
docker compose ps                      # état des conteneurs
docker compose logs -f app             # logs applicatifs
docker compose restart app             # redémarrer l'app
docker compose down                    # tout arrêter (données conservées)
docker compose up -d --build           # redéployer après un git pull
```

## Mise à jour de l'application

```bash
# 1. SAUVEGARDER d'abord (les migrations de schéma ne sont pas réversibles automatiquement)
#    — bouton « Créer un export maintenant » dans l'admin (Tâches planifiées › Exports),
#    ou en ligne de commande :
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists' | gzip -9 > backups/manuel-$(date +%Y%m%d-%H%M%S).sql.gz

# 2. Récupérer la nouvelle version
git pull

# 3. Reconstruire et redémarrer (les migrations Prisma sont jouées à l'entrypoint)
docker compose up -d --build

# 4. Vérifier
docker compose ps
docker compose logs -f app
```

**Rollback** : il n'y a pas de « down-migration » automatique. Pour revenir en arrière :
`git checkout <tag/commit précédent>` puis `docker compose up -d --build`. Si la nouvelle
version avait appliqué une migration **incompatible** avec l'ancien code, restaurer aussi la
base depuis le dump pris à l'étape 1 (cf. § Sauvegarde / restauration). Tester les MAJ sur un
environnement de pré-prod quand c'est possible.

## Sauvegarde de la base

### Automatique (planifiée)

L'app réalise un **dump automatique** (défaut 02h00, planification modifiable dans l'admin :
Administration › Tâches planifiées › CRON) via la route `/api/cron/backup`, appelée toutes
les 5 minutes par le conteneur `cron` : `pg_dump` compressé en gzip, déposé dans
**`./backups/`** sur l'hôte. La **rotation** ne conserve que les **7 dumps automatiques les
plus récents** (≈ une semaine) ; les plus anciens sont supprimés automatiquement.
⚠️ L'export passe par l'app : si elle est indisponible à l'échéance, le dump est rattrapé au
prochain passage une fois l'app relancée.

```bash
# Vérifier les sauvegardes présentes
ls -lh backups/

# Vérifier que les appels du déclencheur partent
docker compose logs -f cron
```

La dernière exécution (et un bouton « Exécuter maintenant ») sont visibles dans l'admin,
onglet Tâches planifiées › CRON.

> 💡 `./backups/` vit sur le même disque que la base : **copie ces dumps hors-site**
> (rsync/scp/objet S3…) pour une vraie protection contre la perte du serveur.

### Manuel / restauration

```bash
# Dump ponctuel
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql

# Restauration depuis un dump compressé du conteneur cron
gunzip -c backups/culturesa-AAAAMMJJ-HHMMSS.sql.gz | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# Restauration depuis un dump .sql non compressé
cat backup.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

## Impression PDF (Puppeteer)
Les éditions (Liste / Planning / Pointages) s'impriment via un PDF généré côté serveur
(route `/services/{id}/editions/pdf?kind=…`) qui pilote un Chromium headless.
- **Docker** : le stage `runner` installe le paquet Alpine `chromium` + polices, et
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` dit à Puppeteer de l'utiliser
  (le Chromium bundlé n'est PAS téléchargé — `PUPPETEER_SKIP_DOWNLOAD=true` au build).
- **Dev local** : `pnpm install` télécharge automatiquement le Chromium bundlé (autorisé
  via `pnpm.onlyBuiltDependencies` dans `package.json`) ; aucune variable à définir.
- `PUPPETEER_BASE_URL` (optionnel) : origine interne que le conteneur utilise pour
  recharger la page d'édition (par défaut l'origine de la requête). À renseigner si le
  conteneur ne joint pas l'URL publique.

## Points d'attention
- `next.config.ts` contient `output: "standalone"` (requis pour l'image Docker).
- Le conteneur `app` tourne en utilisateur non-root (`nextjs`).
- L'app sert en **HTTP** sur `:3000` : si elle est exposée à Internet, placer devant un
  reverse proxy TLS et y reporter les en-têtes de sécurité (HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`).
- `APP_URL` / `NEXT_PUBLIC_APP_URL` (et au besoin `TRUSTED_ORIGINS`) doivent refléter
  l'URL **réellement utilisée par les navigateurs** (celle du proxy, ou `http://<hôte>:3000`
  en accès direct) — sinon l'inscription/connexion échoue (anti-CSRF).

## Fichiers de cette étape
| Fichier | Rôle |
|---|---|
| `Dockerfile` | Build multi-stage Next.js standalone + Prisma |
| `docker-entrypoint.sh` | Migrations Prisma puis démarrage |
| `docker-compose.yml` | app + db + cron + `init` (one-shot) |
| `.env.example` | Modèle de configuration |
| `scripts/install.sh` | Installation automatisée sur serveur vierge |
| `prisma/seed-init.ts` | Init minimal : compte admin + référentiels e-mails (`db:init`) |
| `prisma/seed.ts` | Jeu de démonstration complet (`db:seed`, hors prod) |
| `.dockerignore` / `.gitignore` | Exclusions build/git |
