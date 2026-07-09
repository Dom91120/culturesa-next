-- Les réglages d'ouverture (plages horaires, jours actifs, fériés, vacances
-- scolaires) quittent le SERVICE : chaque EXERCICE devient leur unique porteur.
-- 1) Matérialise dans chaque exercice ses valeurs effectives actuelles
--    (surcharge posée, sinon valeur du service — dernière résolution avant
--    disparition des colonnes du service).
UPDATE "exercice" e SET
  "morningStart"         = COALESCE(e."morningStart",         s."morningStart"),
  "morningEnd"           = COALESCE(e."morningEnd",           s."morningEnd"),
  "afternoonStart"       = COALESCE(e."afternoonStart",       s."afternoonStart"),
  "afternoonEnd"         = COALESCE(e."afternoonEnd",         s."afternoonEnd"),
  "activeDays"           = COALESCE(e."activeDays",           s."activeDays"),
  "openOnHolidays"       = COALESCE(e."openOnHolidays",       s."openOnHolidays"),
  "openOnSchoolHolidays" = COALESCE(e."openOnSchoolHolidays", s."openOnSchoolHolidays")
FROM "services" s
WHERE e."serviceId" = s."id";

-- Exercices orphelins (sans service) : défauts applicatifs.
UPDATE "exercice" SET
  "morningStart"         = COALESCE("morningStart",         '09:00'),
  "morningEnd"           = COALESCE("morningEnd",           '12:00'),
  "afternoonStart"       = COALESCE("afternoonStart",       '14:00'),
  "afternoonEnd"         = COALESCE("afternoonEnd",         '18:00'),
  "activeDays"           = COALESCE("activeDays",           'lun,mar,mer,jeu,ven'),
  "openOnHolidays"       = COALESCE("openOnHolidays",       false),
  "openOnSchoolHolidays" = COALESCE("openOnSchoolHolidays", false)
WHERE "serviceId" IS NULL;

-- 2) Colonnes d'exercice obligatoires, avec défauts (création).
ALTER TABLE "exercice"
  ALTER COLUMN "morningStart"         SET DEFAULT '09:00',
  ALTER COLUMN "morningStart"         SET NOT NULL,
  ALTER COLUMN "morningEnd"           SET DEFAULT '12:00',
  ALTER COLUMN "morningEnd"           SET NOT NULL,
  ALTER COLUMN "afternoonStart"       SET DEFAULT '14:00',
  ALTER COLUMN "afternoonStart"       SET NOT NULL,
  ALTER COLUMN "afternoonEnd"         SET DEFAULT '18:00',
  ALTER COLUMN "afternoonEnd"         SET NOT NULL,
  ALTER COLUMN "activeDays"           SET DEFAULT 'lun,mar,mer,jeu,ven',
  ALTER COLUMN "activeDays"           SET NOT NULL,
  ALTER COLUMN "openOnHolidays"       SET DEFAULT false,
  ALTER COLUMN "openOnHolidays"       SET NOT NULL,
  ALTER COLUMN "openOnSchoolHolidays" SET DEFAULT false,
  ALTER COLUMN "openOnSchoolHolidays" SET NOT NULL;

-- 3) Le service ne porte plus l'ouverture.
ALTER TABLE "services"
  DROP COLUMN "activeDays",
  DROP COLUMN "morningStart",
  DROP COLUMN "morningEnd",
  DROP COLUMN "afternoonStart",
  DROP COLUMN "afternoonEnd",
  DROP COLUMN "openOnHolidays",
  DROP COLUMN "openOnSchoolHolidays";
