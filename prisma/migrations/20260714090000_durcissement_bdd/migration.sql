-- Durcissement issu de l'audit BDD du 2026-07-14 : les invariants métier jusqu'ici
-- garantis par l'application seule deviennent des contraintes de base. Données
-- vérifiées conformes AVANT ce durcissement (0 violation sur chaque règle).

-- ── 1. Nommage : « Disponibilite » était la seule colonne à casse mixte du schéma
-- (identifiant à quoter en SQL brut). Renommée en minuscules ; le champ client
-- Prisma s'appelait déjà `disponibilite` (le @map disparaît, aucun impact code).
ALTER TABLE "periods" RENAME COLUMN "Disponibilite" TO "disponibilite";

-- ── 2. Notification gestionnaires : vocabulaire fermé porté par de vrais enums
-- (mode = none|hours|daily|weekly ; jour = DayOfWeek existant). Les valeurs en
-- base sont déjà conformes (Zod verrouille l'entrée depuis l'origine).
CREATE TYPE "MgrNoticeMode" AS ENUM ('none', 'hours', 'daily', 'weekly');
ALTER TABLE "services" ALTER COLUMN "mgrNoticeMode" DROP DEFAULT;
ALTER TABLE "services"
  ALTER COLUMN "mgrNoticeMode" TYPE "MgrNoticeMode"
  USING "mgrNoticeMode"::"MgrNoticeMode";
ALTER TABLE "services" ALTER COLUMN "mgrNoticeMode" SET DEFAULT 'none';

ALTER TABLE "services" ALTER COLUMN "mgrNoticeWeekday" DROP DEFAULT;
ALTER TABLE "services"
  ALTER COLUMN "mgrNoticeWeekday" TYPE "DayOfWeek"
  USING "mgrNoticeWeekday"::"DayOfWeek";
ALTER TABLE "services" ALTER COLUMN "mgrNoticeWeekday" SET DEFAULT 'lun';

-- ── 3. « Affiché aux utilisateurs » : AU PLUS UN exercice visible par service.
-- L'unicité était applicative (transaction setExerciceVisibleToUsers) ; l'index
-- partiel la rend inviolable. Index partiel = inexprimable en Prisma (comme le
-- NULLS NOT DISTINCT d'uq_recurring) → maintenu en SQL brut, contrôlé au seed.
CREATE UNIQUE INDEX "uq_exercice_visible_par_service"
  ON "exercice" ("serviceId") WHERE "visibleToUsers";

-- ── 4. Miroirs : AU PLUS UN miroir par (créneau parent, date). Garanti de facto
-- par les ids déterministes u_<slot>_<date> ; l'index partiel l'impose en base.
CREATE UNIQUE INDEX "uq_slot_miroir_parent_date"
  ON "slots" ("parentSlotId", "slotDate") WHERE "parentSlotId" IS NOT NULL;

-- ── 5. Vocabulaires fermés et horaires : ceintures de sécurité (déjà validés
-- par Zod côté application ; 0 ligne non conforme au moment de la migration).
ALTER TABLE "bookings" ADD CONSTRAINT "ck_bookings_week"
  CHECK (week IN ('', 'A', 'B'));
ALTER TABLE "slots" ADD CONSTRAINT "ck_slots_weeks"
  CHECK (weeks IS NULL OR weeks IN ('', 'A', 'B', 'A,B'));
-- Horaires HH:MM ou vide (créneau « journée entière ») ; début < fin quand les
-- deux sont renseignés.
ALTER TABLE "slots" ADD CONSTRAINT "ck_slots_horaires"
  CHECK (
    ("startTime" = '' OR "startTime" ~ '^[0-2][0-9]:[0-5][0-9]$')
    AND ("endTime" = '' OR "endTime" ~ '^[0-2][0-9]:[0-5][0-9]$')
    AND ("startTime" = '' OR "endTime" = '' OR "startTime" < "endTime")
  );
