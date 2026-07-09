import type { EntityState, ExerciceType, Prisma } from "@/generated/prisma/client";
import { holidaysInRange } from "@/lib/french-holidays";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";

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

/** Crée un exercice pour un service (date de début ≤ date de fin). */
export async function createExercice(
  serviceId: string,
  input: CreateExerciceInput,
): Promise<ExerciceRow> {
  if (input.dateStart && input.dateEnd && input.dateStart > input.dateEnd) {
    throw new PeriodError("La date de début doit être avant la date de fin.");
  }
  return prisma.exercice.create({
    data: {
      serviceId,
      label: input.label,
      type: input.type,
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
    },
    select: EXERCICE_SELECT,
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
  const current = await prisma.exercice.findUnique({
    where: { id },
    select: { serviceId: true, dateStart: true, dateEnd: true },
  });
  if (!current || current.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
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
  const current = await prisma.exercice.findUnique({
    where: { id },
    select: { serviceId: true, _count: { select: { periods: true } } },
  });
  if (!current || current.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
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
  const exo = await prisma.exercice.findUnique({
    where: { id: exerciceId },
    select: { serviceId: true, dateStart: true, dateEnd: true },
  });
  if (!exo || exo.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
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
  state: EntityState;
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
  state: true,
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

/**
 * Périodes d'un service + liste des exercices distincts présents. Fidèle au
 * legacy : si le service n'a aucune période propre, on retombe sur les périodes
 * globales (serviceId = null).
 */
export async function listServicePeriods(
  serviceId: string,
): Promise<{ periods: PeriodRow[]; exercices: ExerciceRow[] }> {
  let periods = await prisma.period.findMany({
    where: { serviceId },
    select: PERIOD_SELECT,
  });
  if (periods.length === 0) {
    periods = await prisma.period.findMany({
      where: { serviceId: null },
      select: PERIOD_SELECT,
    });
  }
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

/** Crée une période rattachée à un exercice EXPLICITE (state actif). */
export async function createServicePeriod(
  serviceId: string,
  input: CreateServicePeriodInput,
): Promise<PeriodRow> {
  await validatePeriodWithinExercice(serviceId, input.exerciceId, input.dateStart, input.dateEnd);
  const period = await prisma.period.create({
    data: {
      serviceId,
      exerciceId: input.exerciceId,
      label: input.label,
      etiquette: input.etiquette,
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
      disponibilite: input.disponibilite,
      color: input.color,
      state: "actif",
    },
    select: PERIOD_SELECT,
  });
  await refreshPeriodHolidays(period.id);
  return period;
}

export type UpdateServicePeriodInput = {
  label?: string;
  etiquette?: string | null;
  dateStart?: Date | null;
  dateEnd?: Date | null;
  disponibilite?: Date | null;
  color?: string;
  state?: EntityState;
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
    state?: EntityState;
  } = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.etiquette !== undefined) data.etiquette = input.etiquette;
  if (input.disponibilite !== undefined) data.disponibilite = input.disponibilite;
  if (input.color !== undefined) data.color = input.color;
  if (input.state !== undefined) data.state = input.state;

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

  const period = await prisma.period.update({ where: { id }, data, select: PERIOD_SELECT });
  // Les dates ont pu changer → on resynchronise les fériés de la période.
  if (datesChange) await refreshPeriodHolidays(id);
  return period;
}

/** Anti-IDOR : la période doit appartenir au service couvert par le guard appelant. */
export async function deleteServicePeriod(serviceId: string, id: number) {
  const cur = await prisma.period.findUnique({ where: { id }, select: { serviceId: true } });
  if (!cur || cur.serviceId !== serviceId) throw new PeriodError("Période introuvable.");
  return prisma.period.delete({ where: { id } });
}

/** Réactive une période ARCHIVÉE (state → actif ; seuls actif/archive subsistent,
 *  la visibilité usager étant portée par l'exercice). Anti-IDOR par service. */
export async function reactivatePeriod(serviceId: string, id: number): Promise<PeriodRow> {
  const cur = await prisma.period.findUnique({ where: { id }, select: { serviceId: true } });
  if (!cur || cur.serviceId !== serviceId) throw new PeriodError("Période introuvable.");
  return prisma.period.update({
    where: { id },
    data: { state: "actif" },
    select: PERIOD_SELECT,
  });
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
  const ex = await prisma.exercice.findUnique({
    where: { id: exerciceId },
    select: { serviceId: true },
  });
  if (!ex || ex.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
  const activeDays = DAYS.filter((d) => config.activeDays.includes(d)).join(",");
  await prisma.exercice.update({
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
  const ex = await prisma.exercice.findUnique({
    where: { id: exerciceId },
    select: { serviceId: true },
  });
  if (!ex || ex.serviceId !== serviceId) throw new PeriodError("Exercice introuvable.");
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
