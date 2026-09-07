-- Historique de la liste d'attente (Dom 2026-09-07) : la réservation obtenue est FIGÉE
-- (créneau + période) à la clôture — elle reste lisible après suppression de la
-- réservation (bookingId → NULL) — et sa suppression éventuelle est tracée : date,
-- acteur (gestionnaire) et mode (usager / gestionnaire / refus / creneau / periode /
-- exercice).
ALTER TABLE "liste_attente_historique"
  ADD COLUMN "creneauLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "periodeLabel" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reservationSupprimeeAt" TIMESTAMPTZ,
  ADD COLUMN "reservationSupprimeePar" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reservationSupprimeeMode" TEXT NOT NULL DEFAULT '';

-- Lignes existantes encore liées à une réservation : on fige leur créneau.
UPDATE "liste_attente_historique" h
SET "creneauLabel" = CASE
      WHEN s."slotDate" IS NOT NULL THEN to_char(s."slotDate" AT TIME ZONE 'UTC', 'DD/MM/YYYY') || CASE WHEN s."startTime" <> '' AND s."endTime" <> '' THEN ' · ' || left(s."startTime", 5) || ' – ' || left(s."endTime", 5) ELSE ' · Journée entière' END
      ELSE COALESCE(CASE s."slotDay" WHEN 'lun' THEN 'Lundi' WHEN 'mar' THEN 'Mardi' WHEN 'mer' THEN 'Mercredi' WHEN 'jeu' THEN 'Jeudi' WHEN 'ven' THEN 'Vendredi' WHEN 'sam' THEN 'Samedi' WHEN 'dim' THEN 'Dimanche' END, '')
           || CASE WHEN s."startTime" <> '' AND s."endTime" <> '' THEN ' · ' || left(s."startTime", 5) || ' – ' || left(s."endTime", 5) ELSE ' · Journée entière' END
    END,
    "periodeLabel" = COALESCE(p."label", '')
FROM "bookings" b
JOIN "slots" s ON s."id" = b."slotId"
LEFT JOIN "periods" p ON p."id" = b."periodId"
WHERE b."id" = h."bookingId" AND h."creneauLabel" = '';
