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
#    ou en ligne de commande (dump direct depuis Postgres, marche même app HS) :
docker compose exec cron backup.sh

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

## Après la première connexion : retirer `ADMIN_PASSWORD`

> Constat **A8** de l'audit de sécurité.

`ADMIN_PASSWORD` ne sert qu'une fois, au *seed* du compte administrateur (`prisma/seed-init.ts`,
service `init`). Il **reste ensuite en clair dans `.env`** et dans l'environnement Compose,
alors qu'il n'a plus aucune utilité : un mot de passe qui traîne sans servir est un mot de
passe qu'on oublie de faire tourner.

À faire **dès la première connexion réussie** :

```bash
# 1. Se connecter à l'application et changer le mot de passe depuis « Mon compte ».
#    (Le changer d'abord : la suite retire la seule trace du mot de passe initial.)

# 2. Retirer la variable du .env — la ligne entière, pas seulement sa valeur.
sed -i '/^ADMIN_PASSWORD=/d' .env

# 3. Vérifier qu'elle a disparu, y compris d'un éventuel conteneur déjà lancé.
grep -c '^ADMIN_PASSWORD=' .env          # attendu : 0
docker compose exec -T app printenv | grep -c ADMIN_PASSWORD   # attendu : 0
```

Le service `init` ne tourne que sur demande explicite (`--profile init`) : son absence
n'empêche donc rien au quotidien, et `docker-compose.yml` déclare ces deux variables
avec un défaut vide (`${ADMIN_PASSWORD:-}`) pour que Compose n'avertisse pas à chaque
déploiement — un avertissement permanent finit ignoré, y compris le jour où il compte.
La sûreté ne repose pas là-dessus : `prisma/seed-init.ts` refuse de s'exécuter si l'une
des deux est vide, et exige 12 caractères minimum.

S'il faut relancer le seed un jour, la variable se redéfinit le temps de la commande,
sans repasser par le fichier :

```bash
ADMIN_PASSWORD='…' docker compose --profile init run --rm init
```

> **Point connexe, non corrigé.** Le service `init` est construit sur la cible `builder` :
> son image embarque les dépendances de développement **et l'intégralité des sources**.
> Le profil limite son exécution, mais l'image existe sur l'hôte. Pour la retirer une fois
> l'initialisation faite : `docker image rm culturesa-init` (elle sera reconstruite au besoin).

---

## Rotation de `BETTER_AUTH_SECRET`

> Constat **A9** de l'audit de sécurité. **À lire en entier avant d'agir.**

`BETTER_AUTH_SECRET` n'est pas « la clé des sessions » : c'est la **racine HKDF de tout ce
que l'application chiffre ou signe**. Sa rotation n'est pas une opération anodine, et
plusieurs de ses effets sont **silencieux**.

### Ce qui casse, et comment cela se manifeste

| Élément | Effet de la rotation | Visible ? |
|---|---|---|
| **Secrets TOTP et codes de secours** (2FA) | **Illisibles.** Le compte reste marqué « 2FA activée », réclame un code qu'aucune application ne peut produire, et **les codes de secours ne fonctionnent pas non plus** | ❌ **Verrouillage total des administrateurs** |
| **Sauvegardes chiffrées** | Illisibles **si `BACKUP_ENCRYPTION_KEY` n'est pas défini** (la clé est alors dérivée du secret applicatif) | ❌ découvert au moment d'une restauration |
| **Mot de passe SMTP** (`app_config`) | `decryptSecret()` renvoie `""` **sans lever d'exception** → les e-mails cessent de partir | ❌ aucune erreur |
| Sessions | Toutes tombent | ✅ chacun se reconnecte |
| Captchas en circulation | Invalidés (durée de vie : 5 min) | ✅ sans conséquence |
| Liens de suppression de compte | Invalidés (durée de vie : 24 h) | ⚠️ à redemander |
| Compteurs anti-bruteforce | Remis à zéro (indexés sur une empreinte du courriel) | ✅ sans conséquence |

Ce n'est **pas un défaut de conception** : c'est le comportement attendu d'une dérivation
par HKDF, et la séparation par domaine est correcte. Mais l'ordre des opérations compte.

> ⚠️ **Le verrouillage 2FA est le point critique.** Vérifié : un secret chiffré avec
> l'ancienne valeur ne se déchiffre pas avec la nouvelle. Si vous tournez le secret sans
> précaution et que vous êtes le seul administrateur, **personne ne peut plus entrer** —
> le recours est alors une intervention directe en base (requête documentée dans
> `src/app/(admin)/users/actions.ts`).

### Procédure

```bash
# ── AVANT ──────────────────────────────────────────────────────────────────────
# 1. Vérifier que les sauvegardes ne dépendent PAS du secret applicatif.
grep -c '^BACKUP_ENCRYPTION_KEY=.\+' .env      # attendu : 1
#    Si 0 : les dumps existants deviendront illisibles. Définir d'abord une clé
#    dédiée, recréer un export, et le conserver hors machine AVANT de continuer.

# 2. Prévenir les administrateurs : ils devront réinscrire leur second facteur.

# 3. Sauvegarder (bouton « Créer un export maintenant », ou dump direct).

# 4. DÉSACTIVER LE SECOND FACTEUR DE TOUS LES COMPTES.
#    Sans cette étape, les secrets TOTP deviennent illisibles et les comptes
#    restent marqués « 2FA activée » : verrouillage sans recours par l'interface.
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'DELETE FROM two_factor;' \
  -c 'UPDATE "user" SET two_factor_enabled = false;'

# ── ROTATION ───────────────────────────────────────────────────────────────────
# 5. Remplacer la valeur dans .env (32 octets aléatoires).
openssl rand -base64 32          # copier le résultat dans BETTER_AUTH_SECRET

# 6. Redémarrer.
docker compose up -d --build app

# ── APRÈS ──────────────────────────────────────────────────────────────────────
# 7. RE-SAISIR LE MOT DE PASSE SMTP dans Administration › Messagerie.
#    Sans cela les e-mails cessent de partir SANS message d'erreur.
#    Vérifier par le bouton d'envoi de test AVANT de considérer l'opération finie.

# 8. Se reconnecter : le garde du second facteur redirige vers l'enrôlement.
#    Rescanner le QR code et CONSERVER LES NOUVEAUX CODES DE SECOURS.
```

### Vérifications de sortie

Aucune de ces trois n'est facultative : chacune couvre un effet qui, autrement,
se découvre trop tard.

```bash
# Les e-mails repartent  → bouton « Envoyer un test » dans Administration › Messagerie
# Le second facteur      → se déconnecter, se reconnecter, saisir un code TOTP
# Les sauvegardes        → restaurer un dump récent sur une base de répétition
```

---

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
