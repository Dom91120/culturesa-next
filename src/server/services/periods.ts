import type { PeriodInput } from "@/schemas/config";
import { prisma } from "@/server/db";
import type { EntityState } from "@prisma/client";

export function listPeriods() {
  return prisma.period.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: { service: { select: { label: true } } },
  });
}

function toData(data: PeriodInput) {
  return {
    label: data.label,
    etiquette: data.etiquette ?? null,
    serviceId: data.serviceId || null,
    exerciceId: data.exerciceId ?? null,
    dateStart: data.dateStart ?? null,
    dateEnd: data.dateEnd ?? null,
    color: data.color,
    position: data.position,
    state: data.state,
  };
}

export function createPeriod(data: PeriodInput) {
  return prisma.period.create({ data: toData(data) });
}

export function updatePeriod(id: number, data: PeriodInput) {
  return prisma.period.update({ where: { id }, data: toData(data) });
}

export function deletePeriod(id: number) {
  return prisma.period.delete({ where: { id } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sous-onglet Paramètres → Périodes d'ouverture (par service)
// ─────────────────────────────────────────────────────────────────────────────

/** Libellé d'un exercice scolaire à partir de son année de début : « 2025-2026 ». */
export function exerciceLabelForYear(year: number): string {
  return `${year}-${year + 1}`;
}

/** Upsert d'un exercice par libellé. Renvoie son id (création si absent). */
export async function ensureExercice(startYear: number): Promise<number> {
  const label = exerciceLabelForYear(startYear);
  const existing = await prisma.exercice.findFirst({ where: { label }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.exercice.create({ data: { label }, select: { id: true } });
  return created.id;
}

/**
 * Déduit l'exercice (année scolaire) d'une période à partir de ses dates.
 * Référence = dateStart ?? dateEnd ?? maintenant. L'année de début de l'exercice
 * est Y si le mois ≥ août (mois 8), sinon Y-1. Crée l'exercice si nécessaire.
 */
export async function exerciceIdForPeriod(
  dateStart: Date | null,
  dateEnd: Date | null,
): Promise<number> {
  const ref = dateStart ?? dateEnd ?? new Date();
  const y = ref.getUTCFullYear();
  const month = ref.getUTCMonth() + 1; // 1..12
  const startYear = month >= 8 ? y : y - 1;
  return ensureExercice(startYear);
}

export type PeriodRow = {
  id: number;
  label: string;
  etiquette: string | null;
  dateStart: Date | null;
  dateEnd: Date | null;
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
): Promise<{ periods: PeriodRow[]; exercices: { id: number; label: string }[] }> {
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

  const exerciceIds = [
    ...new Set(sorted.map((p) => p.exerciceId).filter((id): id is number => id != null)),
  ];
  const exerciceRows =
    exerciceIds.length > 0
      ? await prisma.exercice.findMany({
          where: { id: { in: exerciceIds } },
          select: { id: true, label: true },
        })
      : [];
  // Tri par label (chronologique car libellés = années scolaires).
  exerciceRows.sort((a, b) => a.label.localeCompare(b.label));

  return { periods: sorted, exercices: exerciceRows };
}

export type CreateServicePeriodInput = {
  label: string;
  etiquette: string | null;
  dateStart: Date | null;
  dateEnd: Date | null;
  color: string;
};

/** Crée une période pour un service (state actif), exerciceId déduit des dates. */
export async function createServicePeriod(
  serviceId: string,
  input: CreateServicePeriodInput,
): Promise<PeriodRow> {
  const exerciceId = await exerciceIdForPeriod(input.dateStart, input.dateEnd);
  return prisma.period.create({
    data: {
      serviceId,
      exerciceId,
      label: input.label,
      etiquette: input.etiquette,
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
      color: input.color,
      state: "actif",
    },
    select: PERIOD_SELECT,
  });
}

export type UpdateServicePeriodInput = {
  label?: string;
  etiquette?: string | null;
  dateStart?: Date | null;
  dateEnd?: Date | null;
  color?: string;
  state?: EntityState;
};

/**
 * Maj partielle d'une période. Si l'une des dates change, l'exerciceId est
 * recalculé à partir des nouvelles dates (en lisant l'autre date inchangée).
 */
export async function updateServicePeriod(
  id: number,
  input: UpdateServicePeriodInput,
): Promise<PeriodRow> {
  const data: {
    label?: string;
    etiquette?: string | null;
    dateStart?: Date | null;
    dateEnd?: Date | null;
    color?: string;
    state?: EntityState;
    exerciceId?: number;
  } = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.etiquette !== undefined) data.etiquette = input.etiquette;
  if (input.color !== undefined) data.color = input.color;
  if (input.state !== undefined) data.state = input.state;

  const datesChange = input.dateStart !== undefined || input.dateEnd !== undefined;
  if (datesChange) {
    const current = await prisma.period.findUnique({
      where: { id },
      select: { dateStart: true, dateEnd: true },
    });
    const nextStart =
      input.dateStart !== undefined ? input.dateStart : (current?.dateStart ?? null);
    const nextEnd = input.dateEnd !== undefined ? input.dateEnd : (current?.dateEnd ?? null);
    data.dateStart = nextStart;
    data.dateEnd = nextEnd;
    data.exerciceId = await exerciceIdForPeriod(nextStart, nextEnd);
  }

  return prisma.period.update({ where: { id }, data, select: PERIOD_SELECT });
}

export function deleteServicePeriod(id: number) {
  return prisma.period.delete({ where: { id } });
}

/** Réactive une période (state → actif). */
export function reactivatePeriod(id: number): Promise<PeriodRow> {
  return prisma.period.update({
    where: { id },
    data: { state: "actif" },
    select: PERIOD_SELECT,
  });
}

export type ServiceOpeningConfig = {
  activeDays: string[];
  openOnHolidays: boolean;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

const DAY_ORDER = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

function parseActiveDays(raw: string): string[] {
  const set = new Set(
    raw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  );
  return DAY_ORDER.filter((d) => set.has(d));
}

/** Lit la config d'ouverture (jours + fériés + plages horaires) d'un service. */
export async function getServiceOpeningConfig(
  serviceId: string,
): Promise<ServiceOpeningConfig | null> {
  const s = await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      activeDays: true,
      openOnHolidays: true,
      morningStart: true,
      morningEnd: true,
      afternoonStart: true,
      afternoonEnd: true,
    },
  });
  if (!s) return null;
  return {
    activeDays: parseActiveDays(s.activeDays),
    openOnHolidays: s.openOnHolidays,
    morningStart: s.morningStart,
    morningEnd: s.morningEnd,
    afternoonStart: s.afternoonStart,
    afternoonEnd: s.afternoonEnd,
  };
}

/** Enregistre la config d'ouverture d'un service (activeDays sérialisé « lun,mar,… »). */
export async function saveServiceOpeningConfig(
  serviceId: string,
  config: ServiceOpeningConfig,
): Promise<void> {
  const activeDays = DAY_ORDER.filter((d) => config.activeDays.includes(d)).join(",");
  await prisma.service.update({
    where: { id: serviceId },
    data: {
      activeDays,
      openOnHolidays: config.openOnHolidays,
      morningStart: config.morningStart,
      morningEnd: config.morningEnd,
      afternoonStart: config.afternoonStart,
      afternoonEnd: config.afternoonEnd,
    },
  });
}
