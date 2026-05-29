-- CreateEnum
CREATE TYPE "Role" AS ENUM ('utilisateur', 'gestionnaire', 'administrateur');

-- CreateEnum
CREATE TYPE "ThemesMode" AS ENUM ('libre', 'liste');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('recurring', 'unique');

-- CreateEnum
CREATE TYPE "EntityState" AS ENUM ('actif', 'desactive', 'archive');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('recurring', 'unique');

-- CreateEnum
CREATE TYPE "Pointage" AS ENUM ('present', 'absent');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT '',
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "prenom" TEXT NOT NULL DEFAULT '',
    "nom" TEXT NOT NULL DEFAULT '',
    "tel" TEXT NOT NULL DEFAULT '',
    "niveau" TEXT NOT NULL DEFAULT '',
    "enfants" SMALLINT NOT NULL DEFAULT 0,
    "accompagnants" SMALLINT NOT NULL DEFAULT 0,
    "role" "Role" NOT NULL DEFAULT 'utilisateur',
    "rgpdOk" BOOLEAN NOT NULL DEFAULT false,
    "demandeurId" INTEGER,
    "structureId" INTEGER,
    "lastLoginAt" TIMESTAMPTZ,
    "anonymizedAt" TIMESTAMPTZ,
    "deletionNoticeSentAt" TIMESTAMPTZ,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "validationBloquante" BOOLEAN NOT NULL DEFAULT false,
    "maxReservations" INTEGER NOT NULL DEFAULT 1,
    "maxReservationsPeriod" INTEGER NOT NULL DEFAULT 1,
    "activeDays" TEXT NOT NULL DEFAULT 'lun,mar,mer,jeu,ven',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ponctDuration" INTEGER NOT NULL DEFAULT 60,
    "ponctCapacity" INTEGER NOT NULL DEFAULT 1,
    "recurDuration" INTEGER NOT NULL DEFAULT 60,
    "recurCapacity" INTEGER NOT NULL DEFAULT 1,
    "morningStart" TEXT NOT NULL DEFAULT '09:00',
    "morningEnd" TEXT NOT NULL DEFAULT '12:00',
    "afternoonStart" TEXT NOT NULL DEFAULT '14:00',
    "afternoonEnd" TEXT NOT NULL DEFAULT '18:00',
    "icon" TEXT,
    "bookingDelay" INTEGER NOT NULL DEFAULT 0,
    "openOnHolidays" BOOLEAN NOT NULL DEFAULT false,
    "showPreviousExercices" BOOLEAN NOT NULL DEFAULT false,
    "themesMode" "ThemesMode" NOT NULL DEFAULT 'libre',
    "autoValidationDelay" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "slotType" "SlotType" NOT NULL DEFAULT 'recurring',
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '10:30',
    "slotDate" DATE,
    "capacity" INTEGER,
    "capLun" INTEGER,
    "capMar" INTEGER,
    "capMer" INTEGER,
    "capJeu" INTEGER,
    "capVen" INTEGER,
    "capSam" INTEGER,
    "capDim" INTEGER,
    "periodId" INTEGER,
    "parentSlotId" TEXT,
    "weeks" TEXT,
    "state" "EntityState" NOT NULL DEFAULT 'actif',

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercice" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" SERIAL NOT NULL,
    "serviceId" TEXT,
    "exerciceId" INTEGER,
    "label" TEXT NOT NULL,
    "etiquette" TEXT,
    "dateStart" DATE,
    "dateEnd" DATE,
    "color" TEXT NOT NULL DEFAULT '#6dceaa',
    "position" INTEGER NOT NULL DEFAULT 0,
    "state" "EntityState" NOT NULL DEFAULT 'actif',

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_events" (
    "id" SERIAL NOT NULL,
    "serviceId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "cycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_holidays" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "period_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_holidays" (
    "id" SERIAL NOT NULL,
    "zone" CHAR(1) NOT NULL,
    "dateStart" DATE NOT NULL,
    "dateEnd" DATE NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "school_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demandeurs" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "openOnSchoolHolidays" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "demandeurs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structures" (
    "id" SERIAL NOT NULL,
    "demandeurId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niveaux" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "demandeurId" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "niveaux_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_demandeurs" (
    "slotId" TEXT NOT NULL,
    "demandeurId" INTEGER NOT NULL,

    CONSTRAINT "slot_demandeurs_pkey" PRIMARY KEY ("slotId","demandeurId")
);

-- CreateTable
CREATE TABLE "service_themes" (
    "id" SERIAL NOT NULL,
    "serviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_demandeur_settings" (
    "serviceId" TEXT NOT NULL,
    "demandeurId" INTEGER NOT NULL,
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "semaineAb" BOOLEAN NOT NULL DEFAULT false,
    "validation" BOOLEAN NOT NULL DEFAULT false,
    "themes" BOOLEAN NOT NULL DEFAULT false,
    "jauge" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "service_demandeur_settings_pkey" PRIMARY KEY ("serviceId","demandeurId")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" SERIAL NOT NULL,
    "bookingType" "BookingType" NOT NULL DEFAULT 'recurring',
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "periodId" INTEGER NOT NULL DEFAULT 0,
    "dayKey" TEXT NOT NULL DEFAULT '',
    "week" TEXT NOT NULL DEFAULT '',
    "parentBookingId" INTEGER,
    "themeLabel" TEXT NOT NULL DEFAULT '',
    "enfants" SMALLINT NOT NULL DEFAULT 0,
    "accompagnants" SMALLINT NOT NULL DEFAULT 0,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoValidateFrom" TIMESTAMPTZ,
    "pointage" "Pointage",

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rgpd_log" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "actorUserId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rgpd_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_config" (
    "cfg_key" TEXT NOT NULL,
    "cfg_value" TEXT,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("cfg_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_demandeurId_idx" ON "user"("demandeurId");

-- CreateIndex
CREATE INDEX "user_structureId_idx" ON "user"("structureId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "slots_serviceId_idx" ON "slots"("serviceId");

-- CreateIndex
CREATE INDEX "slots_parentSlotId_idx" ON "slots"("parentSlotId");

-- CreateIndex
CREATE INDEX "slots_periodId_idx" ON "slots"("periodId");

-- CreateIndex
CREATE INDEX "periods_serviceId_idx" ON "periods"("serviceId");

-- CreateIndex
CREATE INDEX "periods_exerciceId_idx" ON "periods"("exerciceId");

-- CreateIndex
CREATE INDEX "cycle_events_serviceId_createdAt_idx" ON "cycle_events"("serviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "period_holidays_periodId_date_key" ON "period_holidays"("periodId", "date");

-- CreateIndex
CREATE INDEX "school_holidays_zone_dateStart_dateEnd_idx" ON "school_holidays"("zone", "dateStart", "dateEnd");

-- CreateIndex
CREATE INDEX "structures_demandeurId_idx" ON "structures"("demandeurId");

-- CreateIndex
CREATE INDEX "niveaux_demandeurId_idx" ON "niveaux"("demandeurId");

-- CreateIndex
CREATE INDEX "slot_demandeurs_demandeurId_idx" ON "slot_demandeurs"("demandeurId");

-- CreateIndex
CREATE INDEX "service_themes_serviceId_idx" ON "service_themes"("serviceId");

-- CreateIndex
CREATE INDEX "service_demandeur_settings_demandeurId_idx" ON "service_demandeur_settings"("demandeurId");

-- CreateIndex
CREATE INDEX "bookings_userId_idx" ON "bookings"("userId");

-- CreateIndex
CREATE INDEX "bookings_serviceId_idx" ON "bookings"("serviceId");

-- CreateIndex
CREATE INDEX "bookings_periodId_idx" ON "bookings"("periodId");

-- CreateIndex
CREATE INDEX "bookings_slotId_idx" ON "bookings"("slotId");

-- CreateIndex
CREATE INDEX "bookings_parentBookingId_idx" ON "bookings"("parentBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_userId_serviceId_slotId_periodId_dayKey_week_key" ON "bookings"("userId", "serviceId", "slotId", "periodId", "dayKey", "week");

-- CreateIndex
CREATE INDEX "rgpd_log_action_idx" ON "rgpd_log"("action");

-- CreateIndex
CREATE INDEX "rgpd_log_targetUserId_idx" ON "rgpd_log"("targetUserId");

-- CreateIndex
CREATE INDEX "rgpd_log_actorUserId_idx" ON "rgpd_log"("actorUserId");

-- CreateIndex
CREATE INDEX "rgpd_log_createdAt_idx" ON "rgpd_log"("createdAt");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "demandeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "structures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "exercice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_events" ADD CONSTRAINT "cycle_events_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_holidays" ADD CONSTRAINT "period_holidays_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structures" ADD CONSTRAINT "structures_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "demandeurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niveaux" ADD CONSTRAINT "niveaux_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "demandeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_demandeurs" ADD CONSTRAINT "slot_demandeurs_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_demandeurs" ADD CONSTRAINT "slot_demandeurs_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "demandeurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_themes" ADD CONSTRAINT "service_themes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_demandeur_settings" ADD CONSTRAINT "service_demandeur_settings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_demandeur_settings" ADD CONSTRAINT "service_demandeur_settings_demandeurId_fkey" FOREIGN KEY ("demandeurId") REFERENCES "demandeurs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
