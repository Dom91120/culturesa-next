import type { Prisma } from "@/generated/prisma/client";

/**
 * Réglages d'ouverture (plages horaires + jours d'ouverture) — portés PAR EXERCICE,
 * source unique (le service n'en a plus). Ce module est LA résolution : panneau
 * Périodes, générations de miroirs, contrôles de réservation et grilles agenda
 * passent tous par lui.
 *
 * Conventions (décisions produit) :
 *   - une date couverte par AUCUN exercice est FERMÉE (openingForDate → null) ;
 *   - les contrôles liés à une date (vacances scolaires, délai en jours ouvrés)
 *     utilisent l'exercice couvrant la DATE VISÉE ;
 *   - le temps OUVRÉ « qui s'écoule » (auto-validation) utilise l'exercice couvrant
 *     la date de départ, avec repli DEFAULT_OPENING (sinon les échéances gèleraient).
 */

/** Réglages d'ouverture effectifs (ceux d'un exercice) + délai de réservation, tous
 *  portés par l'exercice et résolus par la date. */
export type OpeningConfig = {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  activeDays: string; // CSV « lun,mar,… »
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
  // Délai limite de réservation (encodage legacy, cf. lib/booking-delay).
  bookingDelay: number;
};

/** Défauts applicatifs (création d'exercice, repli du temps ouvré). Alignés sur
 * les DEFAULT du schéma Prisma (Exercice). */
export const DEFAULT_OPENING: OpeningConfig = {
  morningStart: "09:00",
  morningEnd: "12:00",
  afternoonStart: "14:00",
  afternoonEnd: "18:00",
  activeDays: "lun,mar,mer,jeu,ven",
  openOnHolidays: false,
  openOnSchoolHolidays: false,
  bookingDelay: 0,
};

/** Sélection Prisma des réglages d'ouverture d'un exercice. */
export const EXERCICE_OPENING_SELECT = {
  morningStart: true,
  morningEnd: true,
  afternoonStart: true,
  afternoonEnd: true,
  activeDays: true,
  openOnHolidays: true,
  openOnSchoolHolidays: true,
  bookingDelay: true,
} as const;

/**
 * Exercice du service couvrant la date « YYYY-MM-DD » (bornes incluses), avec ses
 * réglages d'ouverture ; null si aucun. `db` accepte le client global ou un tx.
 */
export async function exerciceForDate(
  db: Prisma.TransactionClient,
  serviceId: string,
  dateYmd: string,
): Promise<(OpeningConfig & { id: number }) | null> {
  const date = new Date(`${dateYmd}T00:00:00.000Z`);
  return db.exercice.findFirst({
    where: {
      serviceId,
      dateStart: { lte: date },
      dateEnd: { gte: date },
    },
    select: { id: true, ...EXERCICE_OPENING_SELECT },
    // Départage DÉTERMINISTE par id croissant si deux exercices se chevauchent
    // (un findFirst sans orderBy dépendait du plan d'exécution — audit 2026-07-19,
    // même correctif que periodIdCoveringDate).
    orderBy: { id: "asc" },
  });
}

/**
 * Réglages effectifs pour une DATE : ceux de l'exercice couvrant, sinon `null`
 * (= FERMÉ : rien n'est réservable hors de tout exercice).
 */
export async function openingForDate(
  db: Prisma.TransactionClient,
  serviceId: string,
  dateYmd: string,
): Promise<OpeningConfig | null> {
  return exerciceForDate(db, serviceId, dateYmd);
}

/** Réglages d'ouverture d'un exercice par id ; null si introuvable. */
export async function openingForExercice(
  db: Prisma.TransactionClient,
  exerciceId: number | null,
): Promise<OpeningConfig | null> {
  if (exerciceId == null) return null;
  return db.exercice.findUnique({
    where: { id: exerciceId },
    select: EXERCICE_OPENING_SELECT,
  });
}
