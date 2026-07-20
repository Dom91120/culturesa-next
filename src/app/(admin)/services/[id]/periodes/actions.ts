"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { DAYS, stringIdSchema } from "@/schemas/config";
import { DATE_RE, TIME_RE } from "@/schemas/slot";
import { requireServiceManager } from "@/server/guards";
import {
  createExercice,
  createServicePeriod,
  deleteExercice,
  deleteServicePeriod,
  PeriodError,
  saveExerciceBookingDelay,
  saveExerciceMaxima,
  saveExerciceOpeningConfig,
  setExerciceVisibleToUsers,
  updateExercice,
  updateServicePeriod,
} from "@/server/services/periods";

/** « YYYY-MM-DD » → Date (UTC minuit) ; vide → null. */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

const dateString = z.string().regex(DATE_RE, "Date invalide.").nullable().optional();

// Refine partagé : si les deux dates sont fournies, début ≤ fin (comparaison
// lexicographique valide sur des dates ISO YYYY-MM-DD).
const dateOrderOk = (d: { dateStart?: string | null; dateEnd?: string | null }) =>
  !d.dateStart || !d.dateEnd || d.dateStart <= d.dateEnd;
const dateOrderError = {
  message: "La date de fin doit être postérieure ou égale à la date de début.",
  path: ["dateEnd"] as [string],
};

const colorString = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide.")
  .default("#6dceaa");

// Base UNIQUE période : le schéma de mise à jour = base + id (avant l'audit
// 2026-07-17, create/update étaient deux copies jumelles — un champ ajouté à l'une,
// comme `disponibilite`, pouvait être oublié dans l'autre sans que le typage bronche).
const periodBase = z.object({
  serviceId: stringIdSchema,
  label: z.string().trim().min(1, "Le libellé est requis."),
  etiquette: z.string().trim().max(120).optional().default(""),
  dateStart: dateString,
  dateEnd: dateString,
  // Ouverture des réservations usager (champ « Disponibilité ») ; vide = toujours ouvert.
  disponibilite: dateString,
  color: colorString,
});
const createSchema = periodBase
  .extend({ exerciceId: z.number().int().positive() })
  .refine(dateOrderOk, dateOrderError);
const updateSchema = periodBase
  .extend({ id: z.number().int().positive() })
  .refine(dateOrderOk, dateOrderError);

const exerciceTypeEnum = z.enum(["civile", "scolaire"]);

// Base UNIQUE exercice (même principe que periodBase).
const exerciceBase = z.object({
  serviceId: stringIdSchema,
  label: z.string().trim().min(1, "Le libellé est requis.").max(120),
  type: exerciceTypeEnum,
  dateStart: dateString,
  dateEnd: dateString,
});
const createExerciceSchema = exerciceBase.refine(dateOrderOk, dateOrderError);
const updateExerciceSchema = exerciceBase
  .extend({ id: z.number().int().positive() })
  .refine(dateOrderOk, dateOrderError);

// Cible « serviceId + id » : partagé par les deux suppressions (période, exercice).
const byIdSchema = z.object({
  serviceId: stringIdSchema,
  id: z.number().int().positive(),
});
const deleteExerciceSchema = byIdSchema;
const deleteSchema = byIdSchema;

const openingSchema = z.object({
  serviceId: stringIdSchema,
  // Exercice cible : unique porteur des réglages d'ouverture (le service n'en a plus).
  exerciceId: z.number().int().positive(),
  activeDays: z.array(z.enum(DAYS)).max(7),
  openOnHolidays: z.boolean(),
  openOnSchoolHolidays: z.boolean(),
  morningStart: z.string().regex(TIME_RE, "Heure invalide."),
  morningEnd: z.string().regex(TIME_RE, "Heure invalide."),
  afternoonStart: z.string().regex(TIME_RE, "Heure invalide."),
  afternoonEnd: z.string().regex(TIME_RE, "Heure invalide."),
});

export type CreatePeriodInput = z.input<typeof createSchema>;
export type UpdatePeriodInput = z.input<typeof updateSchema>;
export type SaveOpeningConfigInput = z.input<typeof openingSchema>;
export type CreateExerciceInput = z.input<typeof createExerciceSchema>;
export type UpdateExerciceInput = z.input<typeof updateExerciceSchema>;

export async function createPeriodAction(input: CreatePeriodInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, exerciceId, label, etiquette, dateStart, dateEnd, disponibilite, color } =
    parsed.data;
  try {
    await createServicePeriod(serviceId, {
      exerciceId,
      label,
      etiquette: etiquette ? etiquette : null,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
      disponibilite: toDate(disponibilite),
      color,
    });
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la création." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function updatePeriodAction(input: UpdatePeriodInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { id, serviceId, label, etiquette, dateStart, dateEnd, disponibilite, color } = parsed.data;
  try {
    await updateServicePeriod(serviceId, id, {
      label,
      etiquette: etiquette ? etiquette : null,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
      // Absent (undefined) = inchangé — la modale d'édition ne gère pas ce champ ;
      // null explicite = effacement (colonne « Dispo » vidée).
      disponibilite: disponibilite !== undefined ? toDate(disponibilite) : undefined,
      color,
    });
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function deletePeriodAction(input: {
  serviceId: string;
  id: number;
}): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, id } = parsed.data;
  try {
    await deleteServicePeriod(serviceId, id);
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la suppression." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function createExerciceAction(input: CreateExerciceInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = createExerciceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, label, type, dateStart, dateEnd } = parsed.data;
  try {
    await createExercice(serviceId, {
      label,
      type,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
    });
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la création de l'exercice." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function updateExerciceAction(input: UpdateExerciceInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = updateExerciceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, id, label, type, dateStart, dateEnd } = parsed.data;
  try {
    await updateExercice(serviceId, id, {
      label,
      type,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
    });
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement de l'exercice." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function deleteExerciceAction(input: {
  serviceId: string;
  id: number;
}): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = deleteExerciceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, id } = parsed.data;
  try {
    await deleteExercice(serviceId, id);
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la suppression de l'exercice." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

const maximaSchema = z.object({
  serviceId: stringIdSchema,
  exerciceId: z.number().int().positive(),
  maxReservations: z.coerce.number().int().min(1),
  maxReservationsPeriod: z.coerce.number().int().min(1),
});

export type SaveExerciceMaximaInput = z.input<typeof maximaSchema>;

/** Maximums de réservation de l'exercice (par période / « par an » = sur l'exercice). */
export async function saveExerciceMaximaAction(
  input: SaveExerciceMaximaInput,
): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = maximaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, exerciceId, maxReservations, maxReservationsPeriod } = parsed.data;
  try {
    await saveExerciceMaxima(serviceId, exerciceId, { maxReservations, maxReservationsPeriod });
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

const bookingDelaySchema = z.object({
  serviceId: stringIdSchema,
  exerciceId: z.number().int().positive(),
  // Encodage legacy permissif : <0 (jours ouvrés), 0, ou ≥1000 (calendaire).
  bookingDelay: z.coerce.number().int(),
});

export type SaveExerciceBookingDelayInput = z.input<typeof bookingDelaySchema>;

/** Délai limite de réservation de l'exercice (déplacé du service). */
export async function saveExerciceBookingDelayAction(
  input: SaveExerciceBookingDelayInput,
): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = bookingDelaySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, exerciceId, bookingDelay } = parsed.data;
  try {
    await saveExerciceBookingDelay(serviceId, exerciceId, bookingDelay);
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

const visibleToUsersSchema = z.object({
  serviceId: stringIdSchema,
  exerciceId: z.number().int().positive(),
  visible: z.boolean(),
});

/**
 * « Affiché aux utilisateurs » : marque l'exercice comme l'unique exercice du
 * service accessible côté usager (cocher décoche les autres).
 */
export async function setExerciceVisibleAction(input: {
  serviceId: string;
  exerciceId: number;
  visible: boolean;
}): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = visibleToUsersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, exerciceId, visible } = parsed.data;
  try {
    await setExerciceVisibleToUsers(serviceId, exerciceId, visible);
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}

export async function saveOpeningConfigAction(input: SaveOpeningConfigInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, exerciceId, ...config } = parsed.data;
  try {
    await saveExerciceOpeningConfig(serviceId, exerciceId, config);
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}
