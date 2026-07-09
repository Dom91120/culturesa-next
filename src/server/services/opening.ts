import type { Prisma } from "@/generated/prisma/client";

/**
 * Réglages d'ouverture (plages horaires + jours d'ouverture) résolus PAR EXERCICE.
 *
 * Le service porte les valeurs par défaut ; chaque exercice peut les surcharger
 * (colonnes nullables d'Exercice : null = hérite du service). Ce module est LA
 * résolution unique — panneau Périodes, générations de miroirs, contrôles de
 * réservation et grilles agenda doivent tous passer par lui.
 *
 * Convention de résolution par date (décision produit) : les contrôles liés à une
 * date (vacances scolaires, délai en jours ouvrés) utilisent l'exercice couvrant la
 * DATE VISÉE (pas la date du jour) ; hors de tout exercice → réglages du service.
 */

/** Champs du service portant les défauts d'ouverture. */
export type ServiceOpeningDefaults = {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  activeDays: string; // CSV « lun,mar,… »
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
};

/** Surcharges (nullables) portées par un exercice. */
export type ExerciceOpeningOverrides = {
  morningStart: string | null;
  morningEnd: string | null;
  afternoonStart: string | null;
  afternoonEnd: string | null;
  activeDays: string | null;
  openOnHolidays: boolean | null;
  openOnSchoolHolidays: boolean | null;
};

/** Réglages effectifs après résolution exercice → service. */
export type OpeningConfig = ServiceOpeningDefaults;

/** Sélection Prisma des surcharges d'ouverture d'un exercice. */
export const EXERCICE_OPENING_SELECT = {
  morningStart: true,
  morningEnd: true,
  afternoonStart: true,
  afternoonEnd: true,
  activeDays: true,
  openOnHolidays: true,
  openOnSchoolHolidays: true,
} as const;

/** Fusionne les réglages : valeur de l'exercice si posée, sinon celle du service. */
export function resolveOpening(
  service: ServiceOpeningDefaults,
  exercice?: ExerciceOpeningOverrides | null,
): OpeningConfig {
  return {
    morningStart: exercice?.morningStart ?? service.morningStart,
    morningEnd: exercice?.morningEnd ?? service.morningEnd,
    afternoonStart: exercice?.afternoonStart ?? service.afternoonStart,
    afternoonEnd: exercice?.afternoonEnd ?? service.afternoonEnd,
    activeDays: exercice?.activeDays ?? service.activeDays,
    openOnHolidays: exercice?.openOnHolidays ?? service.openOnHolidays,
    openOnSchoolHolidays: exercice?.openOnSchoolHolidays ?? service.openOnSchoolHolidays,
  };
}

/**
 * Exercice du service couvrant la date « YYYY-MM-DD » (bornes incluses), avec ses
 * surcharges d'ouverture ; null si aucun. `db` accepte le client global ou un tx.
 */
export async function exerciceForDate(
  db: Prisma.TransactionClient,
  serviceId: string,
  dateYmd: string,
): Promise<(ExerciceOpeningOverrides & { id: number }) | null> {
  const date = new Date(`${dateYmd}T00:00:00.000Z`);
  return db.exercice.findFirst({
    where: {
      serviceId,
      dateStart: { lte: date },
      dateEnd: { gte: date },
    },
    select: { id: true, ...EXERCICE_OPENING_SELECT },
  });
}

/** Réglages effectifs pour une DATE donnée (exercice couvrant, sinon service). */
export async function openingForDate(
  db: Prisma.TransactionClient,
  serviceId: string,
  service: ServiceOpeningDefaults,
  dateYmd: string,
): Promise<OpeningConfig> {
  const exercice = await exerciceForDate(db, serviceId, dateYmd);
  return resolveOpening(service, exercice);
}
