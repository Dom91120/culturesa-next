"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { requireServiceManager } from "@/server/guards";
import {
  createExercice,
  createServicePeriod,
  deleteExercice,
  deleteServicePeriod,
  PeriodError,
  reactivatePeriod,
  saveServiceOpeningConfig,
  updateExercice,
  updateServicePeriod,
} from "@/server/services/periods";

/** « YYYY-MM-DD » → Date (UTC minuit) ; vide → null. */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.")
  .nullable()
  .optional();

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

const createSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    exerciceId: z.number().int().positive(),
    label: z.string().trim().min(1, "Le libellé est requis."),
    etiquette: z.string().trim().max(120).optional().default(""),
    dateStart: dateString,
    dateEnd: dateString,
    // Ouverture des réservations usager (champ « Disponibilité ») ; vide = toujours ouvert.
    disponibilite: dateString,
    color: colorString,
  })
  .refine(dateOrderOk, dateOrderError);

const exerciceTypeEnum = z.enum(["civile", "scolaire"]);

const createExerciceSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    label: z.string().trim().min(1, "Le libellé est requis.").max(120),
    type: exerciceTypeEnum,
    dateStart: dateString,
    dateEnd: dateString,
  })
  .refine(dateOrderOk, dateOrderError);

const updateExerciceSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    id: z.number().int().positive(),
    label: z.string().trim().min(1, "Le libellé est requis.").max(120),
    type: exerciceTypeEnum,
    dateStart: dateString,
    dateEnd: dateString,
  })
  .refine(dateOrderOk, dateOrderError);

const deleteExerciceSchema = z.object({
  serviceId: z.string().trim().min(1),
  id: z.number().int().positive(),
});

const updateSchema = z
  .object({
    id: z.number().int().positive(),
    serviceId: z.string().trim().min(1),
    label: z.string().trim().min(1, "Le libellé est requis."),
    etiquette: z.string().trim().max(120).optional().default(""),
    dateStart: dateString,
    dateEnd: dateString,
    // Ouverture des réservations usager (colonne « Dispo ») ; vide = toujours ouvert.
    disponibilite: dateString,
    color: colorString,
  })
  .refine(dateOrderOk, dateOrderError);

const reactivateSchema = z.object({
  serviceId: z.string().trim().min(1),
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

const deleteSchema = z.object({
  serviceId: z.string().trim().min(1),
  id: z.number().int().positive(),
});

const openingSchema = z.object({
  serviceId: z.string().trim().min(1),
  activeDays: z.array(z.enum(["lun", "mar", "mer", "jeu", "ven", "sam", "dim"])).max(7),
  openOnHolidays: z.boolean(),
  openOnSchoolHolidays: z.boolean(),
  morningStart: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  morningEnd: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  afternoonStart: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  afternoonEnd: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
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

export async function reactivatePeriodsAction(input: {
  serviceId: string;
  ids: number[];
}): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = reactivateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, ids } = parsed.data;
  try {
    for (const id of ids) {
      await reactivatePeriod(serviceId, id);
    }
  } catch (e) {
    if (e instanceof PeriodError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la réactivation." };
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

export async function saveOpeningConfigAction(input: SaveOpeningConfigInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = openingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, ...config } = parsed.data;
  try {
    await saveServiceOpeningConfig(serviceId, config);
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/periodes`);
  return { ok: true };
}
