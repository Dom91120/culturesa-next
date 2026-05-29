# Déploiement — CultuRésa (Next.js auto-hébergé)

Stack de prod : **Next.js standalone** + **PostgreSQL 17** + **Caddy** (reverse proxy + HTTPS auto), orchestrés par Docker Compose.

## Prérequis sur le VPS
- Docker + plugin Compose (`docker compose version`)
- Ports **80** et **443** ouverts (firewall)
- Un nom de domaine pointant (enregistrement A/AAAA) vers l'IP du VPS

## Mise en route

```bash
# 1. Récupérer le code
git clone <ton-repo> culturesa && cd culturesa

# 2. Configurer l'environnement
cp .env.example .env
nano .env            # renseigne domaine, mots de passe, SMTP...

# Générer les secrets :
openssl rand -base64 32   # -> BETTER_AUTH_SECRET

# 3. Construire et lancer
docker compose up -d --build

# 4. Suivre les logs
docker compose logs -f app
```

Au démarrage, `docker-entrypoint.sh` applique automatiquement les migrations
Prisma (`prisma migrate deploy`), puis lance le serveur Node.

## Opérations courantes

```bash
docker compose ps                      # état des conteneurs
docker compose logs -f app             # logs applicatifs
docker compose restart app             # redémarrer l'app
docker compose down                    # tout arrêter (données conservées)
docker compose up -d --build           # redéployer après un git pull
```

## Sauvegarde de la base

```bash
# Dump
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql

# Restauration
cat backup.sql | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

> 💡 Pense à planifier un `pg_dump` via cron + une copie hors-site.

## Points d'attention
- `next.config.ts` **doit** contenir `output: "standalone"` (sera ajouté à l'étape projet).
- Le conteneur `app` tourne en utilisateur non-root (`nextjs`).
- HTTP/3 est activé (port 443/udp).
- Pour le dev local sans domaine : mets `APP_DOMAIN=localhost` dans `.env`
  (Caddy génère alors un certificat interne auto-signé).

## Fichiers de cette étape
| Fichier | Rôle |
|---|---|
| `Dockerfile` | Build multi-stage Next.js standalone + Prisma |
| `docker-entrypoint.sh` | Migrations Prisma puis démarrage |
| `docker-compose.yml` | app + db + caddy |
| `Caddyfile` | Reverse proxy + HTTPS |
| `.env.example` | Modèle de configuration |
| `.dockerignore` / `.gitignore` | Exclusions build/git |
