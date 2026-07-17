# CultuRésa — version Next.js

Réservation de créneaux d'activités culturelles.
Réécriture de l'ancienne application PHP/LAMP en stack TypeScript moderne.

## Stack
- **Next.js 15** (App Router, React 19, Server Actions) + **TypeScript**
- **Prisma 6** + **PostgreSQL 17**
- **Better Auth** (email/password, vérification email, reset, rôles, rate-limit)
- **Tailwind CSS v4** (UI à compléter avec shadcn/ui)
- **Zod** (validation), **Nodemailer** (emails)
- **Biome** (lint + format), **pnpm**
- Déploiement **Docker** (app + PostgreSQL + cron) — voir [DEPLOY.md](./DEPLOY.md)

## Prérequis (poste de dev)
- **Node.js ≥ 22** — https://nodejs.org (LTS)
- **pnpm** : `corepack enable && corepack prepare pnpm@latest --activate`
- **Docker** (pour PostgreSQL en local et pour le déploiement)

## Démarrage en local

```bash
# 1. Dépendances
pnpm install

# 2. Configuration
cp .env.example .env
#   -> renseigne DATABASE_URL (décommente la ligne dev),
#      BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL=http://localhost:3000

# Lancer juste une base Postgres locale via Docker :
docker run --name culturesa-db -e POSTGRES_USER=culturesa \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=culturesa \
  -p 5432:5432 -d postgres:17-alpine
# DATABASE_URL=postgresql://culturesa:dev@localhost:5432/culturesa?schema=public

# 3. Base de données
pnpm db:migrate          # crée les tables (1ère migration)
pnpm db:seed             # données de démo + admin

# 4. Lancer le serveur de dev
pnpm dev                 # http://localhost:3000
```

Compte admin de démo : `admin@culturesa.fr` / `Admin1234!`

## Scripts utiles
| Commande | Rôle |
|---|---|
| `pnpm dev` | Serveur de développement |
| `pnpm build` / `pnpm start` | Build de prod / lancement |
| `pnpm db:migrate` | Nouvelle migration (dev) |
| `pnpm db:deploy` | Applique les migrations (prod) |
| `pnpm db:seed` | Données de démo |
| `pnpm db:studio` | Explorateur Prisma Studio |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm typecheck` | Vérification TypeScript |
| `pnpm gen:docs` | Régénère la page d'aide (`public/aide/…html`) depuis `docs/Guide-utilisation.md` |

## Documentation
| Document | Public | Contenu |
|---|---|---|
| [docs/Guide-utilisation.md](docs/Guide-utilisation.md) | Usager, gestionnaire, administrateur | Prise en main fonctionnelle (réserver, créneaux, validation, pointages, éditions/stats, administration) |
| [docs/Guide-administration.md](docs/Guide-administration.md) | Installateur / mainteneur | Installation Docker, base de données, sauvegardes |
| [DEPLOY.md](./DEPLOY.md) + [docs/EXPLOITATION.md](docs/EXPLOITATION.md) | Admin système | Déploiement et exploitation au quotidien |
| [docs/BASE-DE-DONNEES.md](docs/BASE-DE-DONNEES.md) | Développeur / DBA | Modèle de données |

**Guide d'utilisation — source unique.** Tout le contenu fonctionnel (texte + captures d'écran
dans `docs/img/`) vit dans [docs/Guide-utilisation.md](docs/Guide-utilisation.md). `pnpm gen:docs`
régénère `public/aide/guide-utilisation.html` — page d'**aide accessible dans l'application**
(menu utilisateur → **📖 Guide d'utilisation**), servie statiquement avec ses captures. Ne pas
éditer ce HTML ni `public/aide/img/` à la main. Pour un **document imprimable**, ouvrir la page
d'aide et « **Imprimer → Enregistrer en PDF** » (feuille de style d'impression dédiée).

Une **présentation interactive** (modale d'accueil) reprend ce guide à la première connexion,
adaptée au rôle ; on peut la revoir via le menu utilisateur → **💡 Revoir la présentation**.

## État d'avancement
Application **fonctionnelle** : référentiels, services / périodes / créneaux, tunnel de
réservation, back-office (agenda, validation, pointages), statistiques, exports CSV, e-mails
transactionnels et RGPD sont en place. Déploiement Docker : voir [DEPLOY.md](./DEPLOY.md) et
[docs/EXPLOITATION.md](docs/EXPLOITATION.md).
