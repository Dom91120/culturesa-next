import type { ExerciceType } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { holidaysInRange } from "@/lib/french-holidays";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";
import { createSyncRecurringCache } from "@/server/services/recurring-children";
import {
  regenerateRecurringMirrorsForPeriodInTx,
  SlotMutationError,
} from "@/server/services/slots";

/** Format UTC 'YYYY-MM-DD' (cohérent avec toISO/fromISO de slots.ts). */
function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * (Re)remplit `period_holidays` avec les jours fériés français tombant dans
 * [dateStart, dateEnd] de la période. Port du legacy `refresh_period_holidays` :
 * appelé à chaque création/màj de période. La génération des miroirs des créneaux
 * récurrents (`saveRecurringSlots` → `computeWantedMirrors`) s'appuie sur cette
 * table pour ne PAS matérialiser de créneau un jour férié quand le service est
 * fermé les fériés. Sans ce remplissage, la table reste vide et les fériés fuient.
 */
export async function refreshPeriodHolidays(
  periodId: number,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  const period = await client.period.findUnique({
    where: { id: periodId },
    select: { dateStart: true, dateEnd: true },
  });
  await client.periodHoliday.deleteMany({ where: { periodId } });
  if (!period?.dateStart || !period?.dateEnd) return;
  const rows = holidaysInRange(ymdUtc(period.dateStart), ymdUtc(period.dateEnd)).map((h) => ({
    periodId,
    date: new Date(`${h.date}T00:00:00Z`),
    label: h.label,
  }));
  if (rows.length) await client.periodHoliday.createMany({ data: rows, skipDuplicates: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-onglet Paramètres → Périodes et réservations (par service)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garde anti-IDOR partagée : l'exercice chargé doit exister ET appartenir au
 * service couvert par le guard de l'action (6 copies identiques avant l'audit
 * 2026-07-17). Renvoie la ligne non-nulle pour chaînage.
 */
function assertExerciceOwned<T extends { serviceId: string | null }>(
  serviceId: string,
  row: T | null,
): T {
  if (!row || row.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
  return row;
}

/** Erreur métier de gestion des périodes/exercices (message destiné à l'admin). */
export class PeriodError extends Error {}

// ── Exercices (entité explicite, par service) ────────────────────────────────

export type ExerciceRow = {
  id: number;
  label: string;
  type: ExerciceType;
  dateStart: Date | null;
  dateEnd: Date | null;
  // Réglages d'ouverture DE l'exercice (unique porteur, cf. opening.ts).
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  activeDays: string;
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
  // « Affiché aux utilisateurs » : l'unique exercice du service accessible côté usager.
  visibleToUsers: boolean;
  // Maximums de réservation PAR USAGER (par période / sur l'exercice « par an »).
  maxReservations: number;
  maxReservationsPeriod: number;
};

const EXERCICE_SELECT = {
  id: true,
  label: true,
  type: true,
  dateStart: true,
  dateEnd: true,
  morningStart: true,
  morningEnd: true,
  afternoonStart: true,
  afternoonEnd: true,
  activeDays: true,
  openOnHolidays: true,
  openOnSchoolHolidays: true,
  visibleToUsers: true,
  maxReservations: true,
  maxReservationsPeriod: true,
} as const;

/** Exercices d'un service (triés par date de début, nulls en dernier, puis libellé). */
export async function listServiceExercices(serviceId: string): Promise<ExerciceRow[]> {
  const rows = await prisma.exercice.findMany({ where: { serviceId }, select: EXERCICE_SELECT });
  return rows.sort((a, b) => {
    const as = a.dateStart?.getTime();
    const bs = b.dateStart?.getTime();
    if (as != null && bs != null) return as - bs || a.label.localeCompare(b.label);
    if (as != null) return -1;
    if (bs != null) return 1;
    return a.label.localeCompare(b.label);
  });
}

export type CreateExerciceInput = {
  label: string;
  type: ExerciceType;
  dateStart: Date | null;
  dateEnd: Date | null;
};

/**
 * Crée un exercice pour un service (date de début ≤ date de fin). « Affiché aux
 * utilisateurs » par défaut, SAUF si un autre exercice du service l'est déjà
 * (unicité par service : créer l'exercice suivant en avance ne doit pas retirer
 * la visibilité de l'exercice en cours).
 */
export async function createExercice(
  serviceId: string,
  input: CreateExerciceInput,
): Promise<ExerciceRow> {
  if (input.dateStart && input.dateEnd && input.dateStart > input.dateEnd) {
    throw new PeriodError("La date de début doit être avant la date de fin.");
  }
  return prisma.$transaction(async (tx) => {
    const alreadyVisible = await tx.exercice.findFirst({
      where: { serviceId, visibleToUsers: true },
      select: { id: true },
    });
    return tx.exercice.create({
      data: {
        serviceId,
        label: input.label,
        type: input.type,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        visibleToUsers: alreadyVisible == null,
      },
      select: EXERCICE_SELECT,
    });
  });
}

export type UpdateExerciceInput = Partial<CreateExerciceInput>;

/**
 * Maj d'un exercice (anti-IDOR : doit appartenir au service). Si on resserre les dates,
 * vérifie que toutes ses périodes datées tiennent encore dans la nouvelle plage.
 */
export async function updateExercice(
  serviceId: string,
  id: number,
  input: UpdateExerciceInput,
): Promise<ExerciceRow> {
  const current = assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id },
      select: { serviceId: true, dateStart: true, dateEnd: true },
    }),
  );
  const nextStart = input.dateStart !== undefined ? input.dateStart : current.dateStart;
  const nextEnd = input.dateEnd !== undefined ? input.dateEnd : current.dateEnd;
  if (nextStart && nextEnd && nextStart > nextEnd) {
    throw new PeriodError("La date de début doit être avant la date de fin.");
  }
  if (nextStart || nextEnd) {
    const periods = await prisma.period.findMany({
      where: { exerciceId: id, dateStart: { not: null }, dateEnd: { not: null } },
      select: { dateStart: true, dateEnd: true, label: true },
    });
    for (const p of periods) {
      if (
        (nextStart && p.dateStart && p.dateStart < nextStart) ||
        (nextEnd && p.dateEnd && p.dateEnd > nextEnd)
      ) {
        throw new PeriodError(`La période « ${p.label} » sortirait de la plage de l'exercice.`);
      }
    }
  }
  const data: {
    label?: string;
    type?: ExerciceType;
    dateStart?: Date | null;
    dateEnd?: Date | null;
  } = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.type !== undefined) data.type = input.type;
  if (input.dateStart !== undefined) data.dateStart = input.dateStart;
  if (input.dateEnd !== undefined) data.dateEnd = input.dateEnd;
  return prisma.exercice.update({ where: { id }, data, select: EXERCICE_SELECT });
}

/** Suppression d'un exercice (anti-IDOR). Refuse s'il a encore des périodes. */
export async function deleteExercice(serviceId: string, id: number): Promise<void> {
  const current = assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id },
      select: { serviceId: true, _count: { select: { periods: true } } },
    }),
  );
  if (current._count.periods > 0) {
    throw new PeriodError("Supprimez d'abord les périodes de cet exercice.");
  }
  await prisma.exercice.delete({ where: { id } });
}

// ── Validation d'une période dans l'exercice choisi ──────────────────────────

/**
 * Valide une période rattachée à un exercice EXPLICITE :
 *   - l'exercice appartient au service ;
 *   - date de début ≤ date de fin ;
 *   - la période tient dans la plage [début, fin] de l'exercice (si définie) ;
 *   - pas de chevauchement avec une autre période du MÊME exercice.
 * Lève `PeriodError` sinon.
 */
async function validatePeriodWithinExercice(
  serviceId: string,
  exerciceId: number,
  dateStart: Date | null,
  dateEnd: Date | null,
  excludePeriodId?: number,
): Promise<void> {
  const exo = assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id: exerciceId },
      select: { serviceId: true, dateStart: true, dateEnd: true },
    }),
  );
  if (dateStart && dateEnd && dateStart > dateEnd) {
    throw new PeriodError("La date de début doit être avant la date de fin.");
  }
  if (
    (exo.dateStart && dateStart && dateStart < exo.dateStart) ||
    (exo.dateEnd && dateEnd && dateEnd > exo.dateEnd)
  ) {
    throw new PeriodError("La période doit tenir dans les dates de l'exercice.");
  }
  if (!dateStart || !dateEnd) return;
  const siblings = await prisma.period.findMany({
    where: {
      exerciceId,
      dateStart: { not: null },
      dateEnd: { not: null },
      ...(excludePeriodId != null ? { id: { not: excludePeriodId } } : {}),
    },
    select: { dateStart: true, dateEnd: true },
  });
  for (const p of siblings) {
    if (!p.dateStart || !p.dateEnd) continue;
    if (!(dateEnd < p.dateStart || dateStart > p.dateEnd)) {
      throw new PeriodError(
        `La période chevauche une autre période de l'exercice (${ymdUtc(p.dateStart)} → ${ymdUtc(p.dateEnd)}).`,
      );
    }
  }
}

export type PeriodRow = {
  id: number;
  label: string;
  etiquette: string | null;
  dateStart: Date | null;
  dateEnd: Date | null;
  // Date d'ouverture des réservations USAGER pour la période (null = toujours ouvert).
  disponibilite: Date | null;
  color: string;
  exerciceId: number | null;
};

const PERIOD_SELECT = {
  id: true,
  label: true,
  etiquette: true,
  dateStart: true,
  dateEnd: true,
  disponibilite: true,
  color: true,
  exerciceId: true,
} as const;

/** Tri legacy : dateStart croissant (nulls en dernier), puis id. */
function sortPeriods(periods: PeriodRow[]): PeriodRow[] {
  return periods.slice().sort((a, b) => {
    const as = a.dateStart?.getTime();
    const bs = b.dateStart?.getTime();
    if (as != null && bs != null) return as - bs || a.id - b.id;
    if (as != null) return -1;
    if (bs != null) return 1;
    return a.id - b.id;
  });
}

/** Périodes d'un service + liste des exercices distincts présents. */
export async function listServicePeriods(
  serviceId: string,
): Promise<{ periods: PeriodRow[]; exercices: ExerciceRow[] }> {
  const periods = await prisma.period.findMany({
    where: { serviceId },
    select: PERIOD_SELECT,
  });
  const sorted = sortPeriods(periods);
  const exercices = await listServiceExercices(serviceId);
  return { periods: sorted, exercices };
}

export type CreateServicePeriodInput = {
  exerciceId: number;
  label: string;
  etiquette: string | null;
  dateStart: Date | null;
  dateEnd: Date | null;
  // Ouverture des réservations usager (null = réservable sans restriction).
  disponibilite: Date | null;
  color: string;
};

/** Crée une période rattachée à un exercice EXPLICITE. */
export async function createServicePeriod(
  serviceId: string,
  input: CreateServicePeriodInput,
): Promise<PeriodRow> {
  await validatePeriodWithinExercice(serviceId, input.exerciceId, input.dateStart, input.dateEnd);
  // Create + peuplement de period_holidays dans UNE transaction : sans quoi un échec du
  // refresh laissait une période avec une table de fériés vide → les miroirs créés
  // ensuite « fuient » les jours fériés (audit 2026-07-19, cf. doc de refreshPeriodHolidays).
  return prisma.$transaction(async (tx) => {
    const period = await tx.period.create({
      data: {
        serviceId,
        exerciceId: input.exerciceId,
        label: input.label,
        etiquette: input.etiquette,
        dateStart: input.dateStart,
        dateEnd: input.dateEnd,
        disponibilite: input.disponibilite,
        color: input.color,
      },
      select: PERIOD_SELECT,
    });
    await refreshPeriodHolidays(period.id, tx);
    return period;
  });
}

export type UpdateServicePeriodInput = {
  label?: string;
  etiquette?: string | null;
  dateStart?: Date | null;
  dateEnd?: Date | null;
  disponibilite?: Date | null;
  color?: string;
};

/**
 * Maj partielle d'une période. Si l'une des dates change, l'exerciceId est
 * recalculé à partir des nouvelles dates (en lisant l'autre date inchangée).
 * Anti-IDOR : la période doit appartenir au service couvert par le guard appelant.
 */
export async function updateServicePeriod(
  serviceId: string,
  id: number,
  input: UpdateServicePeriodInput,
): Promise<PeriodRow> {
  const data: {
    label?: string;
    etiquette?: string | null;
    dateStart?: Date | null;
    dateEnd?: Date | null;
    disponibilite?: Date | null;
    color?: string;
  } = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.etiquette !== undefined) data.etiquette = input.etiquette;
  if (input.disponibilite !== undefined) data.disponibilite = input.disponibilite;
  if (input.color !== undefined) data.color = input.color;

  // Période courante : service (anti-IDOR) + exercice de rattachement (inchangé ici).
  const current = await prisma.period.findUnique({
    where: { id },
    select: { serviceId: true, exerciceId: true, dateStart: true, dateEnd: true },
  });
  if (!current?.serviceId || current.serviceId !== serviceId)
    throw new PeriodError("Période introuvable.");

  const datesChange = input.dateStart !== undefined || input.dateEnd !== undefined;
  if (datesChange) {
    const nextStart = input.dateStart !== undefined ? input.dateStart : current.dateStart;
    const nextEnd = input.dateEnd !== undefined ? input.dateEnd : current.dateEnd;
    // Nouvelles dates : doivent rester dans l'exercice de la période + sans chevauchement.
    if (current.exerciceId != null) {
      await validatePeriodWithinExercice(serviceId, current.exerciceId, nextStart, nextEnd, id);
    }
    data.dateStart = nextStart;
    data.dateEnd = nextEnd;
  }

  // Changement SANS dates (libellé, couleur, dispo, état…) : simple update.
  if (!datesChange) {
    return prisma.period.update({ where: { id }, data, select: PERIOD_SELECT });
  }
  // Dates changées : update + refresh des fériés + régénération des miroirs des créneaux
  // récurrents (et resync des enfants), le tout DANS une transaction sérialisable.
  // Atomique : un refus (réservation sur une date désormais hors période) annule aussi
  // le changement de dates.
  try {
    return await prisma.$transaction(
      async (tx) => {
        const period = await tx.period.update({ where: { id }, data, select: PERIOD_SELECT });
        await refreshPeriodHolidays(id, tx);
        await regenerateRecurringMirrorsForPeriodInTx(tx, serviceId, id);
        return period;
      },
      // Timeout élargi (défaut Prisma 5 s) : la régénération fait O(créneaux) requêtes —
      // aligné sur copyRecurringWeek, sinon P2028 sur une période chargée.
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
        maxWait: 10_000,
      },
    );
  } catch (e) {
    if (e instanceof SlotMutationError) throw new PeriodError(e.message);
    throw e;
  }
}

/**
 * Anti-IDOR : la période doit appartenir au service couvert par le guard appelant.
 * REFUSE si un créneau de la période (récurrent ou miroir) porte une réservation :
 * la suppression cascadait sinon jusqu'aux réservations (Slot.period puis
 * Booking.slot en onDelete: Cascade) alors que updateServicePeriod refuse déjà de
 * rétrécir une période sur une date réservée (décision produit audit 2026-07-14).
 * Vérif « réservé » + suppression atomiques (transaction sérialisable).
 */
export async function deleteServicePeriod(serviceId: string, id: number) {
  const cur = await prisma.period.findUnique({ where: { id }, select: { serviceId: true } });
  if (!cur || cur.serviceId !== serviceId) throw new PeriodError("Période introuvable.");
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Réservations portées par les créneaux de la période (parents récurrents et
        // miroirs via slot.periodId) OU rattachées directement (bookings.periodId).
        const booked = await tx.booking.count({
          where: { OR: [{ slot: { periodId: id } }, { periodId: id }] },
        });
        if (booked > 0) {
          throw new PeriodError(
            "Des réservations existent sur cette période — annulez-les d'abord.",
          );
        }
        return tx.period.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new PeriodError("Modification simultanée détectée, réessayez.");
    }
    throw e;
  }
}

export type ServiceOpeningConfig = {
  activeDays: string[];
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

export function parseActiveDays(raw: string): string[] {
  const set = new Set(
    raw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  );
  return DAYS.filter((d) => set.has(d));
}

/**
 * Enregistre la config d'ouverture d'UN EXERCICE (unique porteur des réglages,
 * cf. opening.ts). Anti-IDOR : l'exercice doit appartenir au service.
 */
export async function saveExerciceOpeningConfig(
  serviceId: string,
  exerciceId: number,
  config: ServiceOpeningConfig,
): Promise<void> {
  assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id: exerciceId },
      select: { serviceId: true },
    }),
  );
  const activeDays = DAYS.filter((d) => config.activeDays.includes(d)).join(",");
  // Update de la config + régénération des miroirs de TOUTES les périodes actives de
  // l'exercice (les jours actifs / fériés ont pu changer), DANS une transaction
  // sérialisable. Atomique : un refus (réservation sur un jour désormais fermé) annule
  // aussi le changement de config.
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.exercice.update({
          where: { id: exerciceId },
          data: {
            activeDays,
            openOnHolidays: config.openOnHolidays,
            openOnSchoolHolidays: config.openOnSchoolHolidays,
            morningStart: config.morningStart,
            morningEnd: config.morningEnd,
            afternoonStart: config.afternoonStart,
            afternoonEnd: config.afternoonEnd,
          },
        });
        const periods = await tx.period.findMany({
          where: { exerciceId, serviceId },
          select: { id: true },
        });
        // Cache partagé entre TOUTES les périodes régénérées : vacances scolaires,
        // ouvertures, délais et politiques demandeur lus une seule fois pour toute
        // la transaction (anti-N+1, audit 2026-07-17). Rempli APRÈS l'update de
        // l'exercice ci-dessus → il capture bien la nouvelle config.
        const syncCache = createSyncRecurringCache();
        for (const p of periods) {
          await regenerateRecurringMirrorsForPeriodInTx(tx, serviceId, p.id, syncCache);
        }
      },
      // Timeout élargi (défaut Prisma 5 s) : régénère TOUTES les périodes de l'exercice —
      // aligné sur cycleService, sinon P2028 sur un exercice annuel chargé.
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
        maxWait: 10_000,
      },
    );
  } catch (e) {
    if (e instanceof SlotMutationError) throw new PeriodError(e.message);
    throw e;
  }
}

/**
 * Maximums de réservation d'UN EXERCICE (par période / sur l'exercice).
 * Anti-IDOR : l'exercice doit appartenir au service. Valeurs ≥ 1.
 */
export async function saveExerciceMaxima(
  serviceId: string,
  exerciceId: number,
  maxima: { maxReservations: number; maxReservationsPeriod: number },
): Promise<void> {
  assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id: exerciceId },
      select: { serviceId: true },
    }),
  );
  await prisma.exercice.update({
    where: { id: exerciceId },
    data: {
      maxReservations: Math.max(1, maxima.maxReservations),
      maxReservationsPeriod: Math.max(1, maxima.maxReservationsPeriod),
    },
  });
}

/**
 * « Affiché aux utilisateurs » : marque l'exercice comme l'UNIQUE exercice du
 * service accessible côté usager (cocher décoche les autres — transaction) ;
 * décocher laisse le service sans exercice visible (aucune réservation usager).
 * Anti-IDOR : l'exercice doit appartenir au service.
 */
export async function setExerciceVisibleToUsers(
  serviceId: string,
  exerciceId: number,
  visible: boolean,
): Promise<void> {
  assertExerciceOwned(
    serviceId,
    await prisma.exercice.findUnique({
      where: { id: exerciceId },
      select: { serviceId: true },
    }),
  );
  await prisma.$transaction(async (tx) => {
    if (visible) {
      await tx.exercice.updateMany({
        where: { serviceId, visibleToUsers: true },
        data: { visibleToUsers: false },
      });
    }
    await tx.exercice.update({ where: { id: exerciceId }, data: { visibleToUsers: visible } });
  });
}
