-- Audit perf 2026-07-24 : "version d'agenda" pour le polling des grilles.
-- updatedAt sur bookings et slots (maintenu par Prisma @updatedAt ; DEFAULT
-- now() pour les lignes existantes et les eventuels inserts hors client).
ALTER TABLE "bookings" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "slots" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
