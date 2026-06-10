"use server";

import type { ActionState } from "@/lib/action-state";
import { requireServiceManager } from "@/server/guards";
import {
  createServicePeriod,
  deleteServicePeriod,
  reactivatePeriod,
  saveServiceOpeningConfig,
  updateServicePeriod,
} from "@/server/services/periods";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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

const colorString = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide.")
  .default("#6dceaa");

const createSchema = z.object({
  serviceId: z.string().trim().min(1),
  label: z.string().trim().min(1, "Le libellé est requis."),
  etiquette: z.string().trim().max(120).optional().default(""),
  dateStart: dateString,
  dateEnd: dateString,
  color: colorString,
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  serviceId: z.string().trim().min(1),
  label: z.string().trim().min(1, "Le libellé est requis."),
  etiquette: z.string().trim().max(120).optional().default(""),
  dateStart: dateString,
  dateEnd: dateString,
  color: colorString,
});

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
  morningStart: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  morningEnd: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  afternoonStart: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
  afternoonEnd: z.string().regex(/^\d{2}:\d{2}$/, "Heure invalide."),
});

export type CreatePeriodInput = z.input<typeof createSchema>;
export type UpdatePeriodInput = z.input<typeof updateSchema>;
export type SaveOpeningConfigInput = z.input<typeof openingSchema>;

export async function createPeriodAction(input: CreatePeriodInput): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  const { serviceId, label, etiquette, dateStart, dateEnd, color } = parsed.data;
  try {
    await createServicePeriod(serviceId, {
      label,
      etiquette: etiquette ? etiquette : null,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
      color,
    });
  } catch {
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
  const { id, serviceId, label, etiquette, dateStart, dateEnd, color } = parsed.data;
  try {
    await updateServicePeriod(id, {
      label,
      etiquette: etiquette ? etiquette : null,
      dateStart: toDate(dateStart),
      dateEnd: toDate(dateEnd),
      color,
    });
  } catch {
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
    await deleteServicePeriod(id);
  } catch {
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
      await reactivatePeriod(id);
    }
  } catch {
    return { ok: false, error: "Échec de la réactivation." };
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
