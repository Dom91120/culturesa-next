# Plan de migration — CultuRésa (PHP/LAMP → Next.js/TypeScript)

> Reconstruction de l'application de réservation de créneaux culturels.
> Cible : **Next.js 15 + TypeScript + Prisma + PostgreSQL 17 + Better Auth**,
> auto-hébergée en Docker (cf. `DEPLOY.md`).

---

## 1. Principes d'architecture

- **App Router** (Next.js 15) : pages = Server Components par défaut, mutations via
  **Server Actions**, endpoints publics via **Route Handlers** (`app/api/...`).
- **Couche métier isolée** : toute la logique (calcul de jauges, auto-validation,
  bascule d'exercice…) vit dans `src/server/services/`, indépendante du framework UI.
  C'est le cœur réutilisable — pas de logique métier dans les composants.
- **Validation unique** avec **Zod** : un schéma par entité, partagé serveur ↔ client.
- **Accès données** via **Prisma** uniquement (pas de SQL brut sauf rares stats).
- **Sécurité par défaut** : toutes les routes admin/gestionnaire passent par un guard
  central (`requireRole`), RGPD activé dès le départ.

### Arborescence cible
```
src/
├── app/
│   ├── (public)/                 # réservation côté usager
│   │   ├── page.tsx              # accueil / liste services
│   │   ├── reserver/             # tunnel de réservation
│   │   └── mon-compte/           # profil, mes réservations, RGPD self-service
│   ├── (admin)/                  # back-office gestionnaire/admin
│   │   ├── services/  slots/  periods/  bookings/
│   │   ├── demandeurs/  structures/  niveaux/
│   │   ├── users/  stats/  settings/  rgpd/
│   ├── api/                      # route handlers (export CSV, webhooks, cron)
│   └── auth/                     # pages login/register/reset (Better Auth)
├── server/
│   ├── db.ts                     # client Prisma singleton
│   ├── auth.ts                   # config Better Auth
│   ├── guards.ts                 # requireUser / requireRole
│   └── services/                 # logique métier (bookings, slots, rgpd, cycle...)
├── lib/                          # utilitaires (dates, jours fériés, CSV)
├── schemas/                      # schémas Zod
└── components/                   # UI (shadcn/ui)
prisma/
├── schema.prisma
└── migrations/
```

---

## 2. Modèle de données (Prisma / PostgreSQL)

Reprise fidèle du schéma MySQL existant, avec les améliorations PostgreSQL :

| MySQL actuel | Prisma / PostgreSQL | Changement |
|---|---|---|
| `ENUM(...)` | `enum` natif PostgreSQL | idem |
| `TINYINT(1)` | `Boolean` | plus propre |
| `JSON` | `Json` (jsonb) | indexable |
| `DATETIME` | `DateTime @db.Timestamptz` | gestion fuseau correcte |
| ids `VARCHAR(64)` (services/slots) | conservés (`String @id`) | compat données |
| ids `AUTO_INCREMENT` | `Int @id @default(autoincrement())` | idem |

**Entités métier** (inchangées vs l'existant) :
`Service`, `Slot`, `Exercice`, `Period`, `CycleEvent`, `PeriodHoliday`,
`SchoolHoliday`, `Demandeur`, `Structure`, `Niveau`, `SlotDemandeur`,
`ServiceTheme`, `ServiceDemandeurSettings`, `Booking`, `RgpdLog`, `AppConfig`.

**Auth — remplacé par Better Auth.** Les tables maison
(`sessions`, `auth_attempts`, `email_confirmations`, `email_change_requests`,
`password_reset_requests`, `account_deletion_requests`) **disparaissent** :
Better Auth fournit `user / session / account / verification` + plugins
(email-verification, password-reset, rate-limit, admin/roles).
On garde sur le `User` les champs métier (`prenom`, `nom`, `tel`, `niveau`,
`enfants`, `accompagnants`, `role`, `rgpd_ok`, `demandeurId`, `structureId`,
`anonymizedAt`, `deletionNoticeSentAt`, `lastLoginAt`) via les *additionalFields*.

---

## 3. Correspondance des fonctionnalités (api/ PHP → modules)

| Endpoint PHP actuel | Module Next.js | Notes |
|---|---|---|
| `auth.php` | Better Auth + `mon-compte` | login/register/reset/confirm/changement email |
| `bookings.php` | `server/services/bookings.ts` | CRUD + jauges + auto-validation + pointage |
| `slots.php` | `server/services/slots.ts` | récurrents + miroirs datés (`parentSlotId`) |
| `services.php` | `server/services/services.ts` | config service + jours actifs |
| `periods.php` / `exercice.php` | `server/services/periods.ts` | périodes, bascule d'exercice + undo (`CycleEvent`) |
| `holidays.php` | `server/services/holidays.ts` | jours fériés période + vacances scolaires zones |
| `demandeurs/structures/niveaux.php` | modules référentiels | CRUD simple |
| `service_themes.php` / `service_demandeur_settings.php` | modules config | matrice service × demandeur |
| `stats.php` | `app/(admin)/stats` | TanStack Table + Recharts |
| `export.php` | `app/api/export/route.ts` | CSV (compat Excel, BOM UTF-8) |
| `rgpd.php` / `rgpd_log.php` / `rgpd_export.php` | `server/services/rgpd.ts` | anonymisation, export, audit, rétention |
| `settings.php` | `app/(admin)/settings` | `AppConfig` clé/valeur |
| `captcha_img.php` | Cloudflare Turnstile | sur register/login |

---

## 4. Points métier délicats à porter (à ne pas perdre)

1. **Auto-validation des réservations** : délai signé en minutes
   (négatif = avant séance en jours *ouvrés* ; positif = après résa en jours
   *calendaires*). Logique à mettre dans un **job cron** (conteneur dédié ou
   route `/api/cron/auto-validate` appelée par cron système).
2. **Jauges/capacités** : capacité par jour de semaine (`capLun…capDim`),
   par service (ponctuel vs récurrent), contrôle de concurrence à la réservation
   (transaction Prisma + verrou pour éviter le sur-booking).
3. **Slots miroirs** : un créneau récurrent génère des enfants datés
   (`parentSlotId`) ; idem `parentBookingId` pour les réservations.
4. **Semaines A/B** (`week`, `weeks`) : alternance paire/impaire.
5. **Restrictions par demandeur** (`SlotDemandeur`) : liste vide = pas de restriction.
6. **Jours fériés + vacances scolaires** : ouverture conditionnelle
   (`openOnHolidays`, `openOnSchoolHolidays`).
7. **RGPD** : anonymisation (pas de suppression dure des logs), export art. 15,
   suppression self-service art. 17 (lien mail 24h), purge automatique des comptes
   inactifs (`lastLoginAt`) avec préavis (`deletionNoticeSentAt`).

---

## 5. Migration des données existantes (MySQL → PostgreSQL)

- Script ponctuel `scripts/migrate-mysql.ts` : lit l'ancienne base MySQL,
  réécrit dans PostgreSQL via Prisma (respect de l'ordre des FK).
- **Mots de passe** : les hash actuels sont `bcrypt` (`$2y$`) → compatibles
  Better Auth (bcrypt), import direct possible ; sinon forcer un reset au 1er login.
- Reprise des ids `VARCHAR` (services/slots) pour ne pas casser les références.

---

## 6. Ordre de construction (étape 3 — le projet)

1. **Bootstrap** : `create-next-app` (TS, App Router, Tailwind v4), pnpm, Biome,
   `next.config` avec `output: "standalone"`.
2. **Prisma** : `schema.prisma` complet + 1ère migration + seed (données de démo
   identiques à l'actuel : demandeurs, niveaux, périodes, services, admin).
3. **Auth** : Better Auth (email/password, vérification email, reset, rôles,
   Turnstile) + guards.
4. **Référentiels** (CRUD simples) : demandeurs, structures, niveaux, exercices.
5. **Cœur métier** : services → périodes → slots → settings service×demandeur.
6. **Réservation** : tunnel usager + jauges + validation + pointage.
7. **Back-office** : dashboard, stats, gestion réservations, users.
8. **RGPD** : export, anonymisation, audit, cron de rétention.
9. **Exports CSV** + emails transactionnels (Nodemailer + React Email).
10. **Finitions** : tests (Vitest + Playwright), accessibilité, build Docker.

---

## 7. Décisions ouvertes (à confirmer avant l'étape 3)

- **Better Auth** pour l'auth, OK ? (alternative : Auth.js)
- **UI** : shadcn/ui (recommandé) — palette/identité visuelle à reprendre de l'actuel
  (accent émeraude `#6dceaa`) ?
- **Migration de données** : on importe l'existant, ou on repart d'une base vierge
  avec seed de démo ?
- **Cron auto-validation/rétention** : conteneur dédié vs cron système du VPS ?
