import { holidaysInRange } from "@/lib/french-holidays";
import { DAYS, type PeriodInput } from "@/schemas/config";
import { prisma } from "@/server/db";
import type { EntityState, Prisma } from "@prisma/client";

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

export async function createPeriod(data: PeriodInput) {
  const period = await prisma.period.create({ data: toData(data) });
  await refreshPeriodHolidays(period.id);
  return period;
}

export async function updatePeriod(id: number, data: PeriodInput) {
  const period = await prisma.period.update({ where: { id }, data: toData(data) });
  await refreshPeriodHolidays(id);
  return period;
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
  return ensureExercice(schoolStartYear(dateStart ?? dateEnd ?? new Date()));
}

/** Année de début d'exercice scolaire pour une date (mois ≥ août → Y, sinon Y-1). */
function schoolStartYear(ref: Date): number {
  const y = ref.getUTCFullYear();
  return ref.getUTCMonth() + 1 >= 8 ? y : y - 1;
}

/** Erreur métier de gestion des périodes (message destiné à l'admin). */
export class PeriodError extends Error {}

/** startYear d'un libellé d'exercice « 2025-2026 » → 2025 (null si non parsable). */
function startYearFromLabel(label: string | null | undefined): number | null {
  const m = label ? /^(\d{4})/.exec(label) : null;
  return m ? Number(m[1]) : null;
}

/** startYear de l'exercice le plus récent du service, ou null si aucune période datée. */
async function latestExerciceStartYearForService(serviceId: string): Promise<number | null> {
  const rows = await prisma.period.findMany({
    where: { serviceId, exerciceId: { not: null } },
    select: { exercice: { select: { label: true } } },
  });
  let max: number | null = null;
  for (const r of rows) {
    const y = startYearFromLabel(r.exercice?.label);
    if (y != null && (max == null || y > max)) max = y;
  }
  return max;
}

/**
 * Verrou « dernier exercice » (port legacy) : création/modification/suppression d'une
 * période limitées à l'exercice le PLUS RÉCENT du service. Les exercices antérieurs sont
 * figés ; on n'ouvre pas non plus manuellement un exercice futur (passer par la bascule).
 * `null` (1ʳᵉ période du service) = autorisé.
 */
async function assertLatestExercice(serviceId: string, targetStartYear: number): Promise<void> {
  const latest = await latestExerciceStartYearForService(serviceId);
  if (latest == null || targetStartYear === latest) return;
  throw new PeriodError(
    targetStartYear < latest
      ? "Les périodes d'un exercice antérieur ne sont plus modifiables."
      : "Création limitée au dernier exercice : utilisez la bascule pour ouvrir un nouvel exercice.",
  );
}

/**
 * Validation période-dans-exercice (port legacy `validate_period_in_exercice`) :
 *   - date de début ≤ date de fin ;
 *   - toutes les périodes de l'exercice tiennent sur ≤ 2 années contigües (tous services) ;
 *   - pas de chevauchement avec une autre période du MÊME service dans l'exercice.
 * Lève `PeriodError` sinon. No-op si dates absentes.
 */
async function validatePeriodInExercice(
  serviceId: string,
  dateStart: Date | null,
  dateEnd: Date | null,
  excludePeriodId?: number,
): Promise<void> {
  if (!dateStart || !dateEnd) return;
  if (dateStart > dateEnd) {
    throw new PeriodError("La date de début doit être avant la date de fin.");
  }
  const label = exerciceLabelForYear(schoolStartYear(dateStart));
  const siblings = await prisma.period.findMany({
    where: {
      exercice: { label },
      dateStart: { not: null },
      dateEnd: { not: null },
      ...(excludePeriodId != null ? { id: { not: excludePeriodId } } : {}),
    },
    select: { serviceId: true, dateStart: true, dateEnd: true },
  });
  let ys = dateStart.getUTCFullYear();
  let ye = dateEnd.getUTCFullYear();
  for (const p of siblings) {
    if (p.dateStart) ys = Math.min(ys, p.dateStart.getUTCFullYear());
    if (p.dateEnd) ye = Math.max(ye, p.dateEnd.getUTCFullYear());
  }
  if (ye - ys > 1) {
    throw new PeriodError(
      "Les périodes d'un exercice doivent tenir sur la même année ou sur 2 années contigües.",
    );
  }
  for (const p of siblings) {
    if (p.serviceId !== serviceId || !p.dateStart || !p.dateEnd) continue;
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
  await validatePeriodInExercice(serviceId, input.dateStart, input.dateEnd);
  await assertLatestExercice(
    serviceId,
    schoolStartYear(input.dateStart ?? input.dateEnd ?? new Date()),
  );
  const exerciceId = await exerciceIdForPeriod(input.dateStart, input.dateEnd);
  const period = await prisma.period.create({
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
  await refreshPeriodHolidays(period.id);
  return period;
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
    color?: string;
    state?: EntityState;
    exerciceId?: number;
  } = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.etiquette !== undefined) data.etiquette = input.etiquette;
  if (input.color !== undefined) data.color = input.color;
  if (input.state !== undefined) data.state = input.state;

  // Période courante (service + exercice) pour le verrou « dernier exercice ».
  const current = await prisma.period.findUnique({
    where: { id },
    select: {
      serviceId: true,
      dateStart: true,
      dateEnd: true,
      exercice: { select: { label: true } },
    },
  });
  if (!current?.serviceId || current.serviceId !== serviceId)
    throw new PeriodError("Période introuvable.");
  const currentStartYear =
    startYearFromLabel(current.exercice?.label) ??
    (current.dateStart ? schoolStartYear(current.dateStart) : null);
  if (currentStartYear != null) await assertLatestExercice(current.serviceId, currentStartYear);

  const datesChange = input.dateStart !== undefined || input.dateEnd !== undefined;
  if (datesChange) {
    const nextStart = input.dateStart !== undefined ? input.dateStart : current.dateStart;
    const nextEnd = input.dateEnd !== undefined ? input.dateEnd : current.dateEnd;
    // Nouvelles dates : validation (≤2 ans, chevauchement) + verrou sur l'exercice cible.
    await validatePeriodInExercice(current.serviceId, nextStart, nextEnd, id);
    await assertLatestExercice(
      current.serviceId,
      schoolStartYear(nextStart ?? nextEnd ?? new Date()),
    );
    data.dateStart = nextStart;
    data.dateEnd = nextEnd;
    data.exerciceId = await exerciceIdForPeriod(nextStart, nextEnd);
  }

  const period = await prisma.period.update({ where: { id }, data, select: PERIOD_SELECT });
  // Les dates ont pu changer → on resynchronise les fériés de la période.
  if (datesChange) await refreshPeriodHolidays(id);
  return period;
}

/** startYear de l'exercice d'une période (par son libellé, repli sur sa date de début). */
async function periodStartYear(
  id: number,
): Promise<{ serviceId: string; startYear: number | null } | null> {
  const cur = await prisma.period.findUnique({
    where: { id },
    select: { serviceId: true, dateStart: true, exercice: { select: { label: true } } },
  });
  if (!cur?.serviceId) return null;
  const startYear =
    startYearFromLabel(cur.exercice?.label) ??
    (cur.dateStart ? schoolStartYear(cur.dateStart) : null);
  return { serviceId: cur.serviceId, startYear };
}

/** Anti-IDOR : la période doit appartenir au service couvert par le guard appelant. */
export async function deleteServicePeriod(serviceId: string, id: number) {
  const cur = await periodStartYear(id);
  if (!cur || cur.serviceId !== serviceId) throw new PeriodError("Période introuvable.");
  if (cur.startYear != null) await assertLatestExercice(cur.serviceId, cur.startYear);
  return prisma.period.delete({ where: { id } });
}

/** Réactive une période (state → actif). Limité au dernier exercice du service. */
export async function reactivatePeriod(serviceId: string, id: number): Promise<PeriodRow> {
  const cur = await periodStartYear(id);
  if (!cur || cur.serviceId !== serviceId) throw new PeriodError("Période introuvable.");
  if (cur.startYear != null) await assertLatestExercice(cur.serviceId, cur.startYear);
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

function parseActiveDays(raw: string): string[] {
  const set = new Set(
    raw
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  );
  return DAYS.filter((d) => set.has(d));
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
      openOnSchoolHolidays: true,
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
    openOnSchoolHolidays: s.openOnSchoolHolidays,
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
  const activeDays = DAYS.filter((d) => config.activeDays.includes(d)).join(",");
  await prisma.service.update({
    where: { id: serviceId },
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
