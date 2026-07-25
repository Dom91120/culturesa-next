"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { stringIdSchema } from "@/schemas/config";
import { requireServiceManager } from "@/server/guards";
import {
  CycleError,
  cycleService,
  setShowPreviousExercices,
  undoCycle,
} from "@/server/services/exercice";

/** Variante d'ActionState renvoyant les compteurs du cycle. */
export type CycleActionState =
  | { ok: true; created: number; slotsCreated: number; multiSlotsCreated: number }
  | { ok: false; error: string };

function revalidate(serviceId: string): void {
  revalidatePath(`/services/${serviceId}/exercice`);
  revalidatePath(`/services/${serviceId}/periodes`);
  revalidatePath(`/services/${serviceId}/agenda`);
}

export async function setShowPreviousExercicesAction(
  serviceId: string,
  value: boolean,
): Promise<ActionState> {
  // Valider d'abord (valeur normalisée) puis garder avec le serviceId validé.
  const parsed = z
    .object({ serviceId: stringIdSchema, value: z.boolean() })
    .safeParse({ serviceId, value });
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  await requireServiceManager(parsed.data.serviceId);
  try {
    await setShowPreviousExercices(parsed.data.serviceId, parsed.data.value);
    revalidate(parsed.data.serviceId);
    return { ok: true };
  } catch (err) {
    if (err instanceof CycleError) return { ok: false, error: err.message };
    console.error("[exercice] setShowPreviousExercices", err);
    return { ok: false, error: "Échec de l'enregistrement." };
  }
}

const cycleSchema = z.object({
  serviceId: stringIdSchema,
  recreatePeriods: z.boolean(),
  recreateSlots: z.boolean(),
  recreateMultiSlots: z.boolean(),
});

export async function cycleAction(
  serviceId: string,
  recreatePeriods: boolean,
  recreateSlots: boolean,
  recreateMultiSlots: boolean,
): Promise<CycleActionState> {
  const parsed = cycleSchema.safeParse({
    serviceId,
    recreatePeriods,
    recreateSlots,
    recreateMultiSlots,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  await requireServiceManager(parsed.data.serviceId);
  try {
    const res = await cycleService(parsed.data.serviceId, {
      recreatePeriods: parsed.data.recreatePeriods,
      recreateSlots: parsed.data.recreateSlots,
      recreateMultiSlots: parsed.data.recreateMultiSlots,
    });
    revalidate(parsed.data.serviceId);
    return {
      ok: true,
      created: res.created,
      slotsCreated: res.slotsCreated,
      multiSlotsCreated: res.multiSlotsCreated,
    };
  } catch (err) {
    if (err instanceof CycleError) return { ok: false, error: err.message };
    console.error("[exercice] cycleService", err);
    return { ok: false, error: "Échec du cycle." };
  }
}

const undoSchema = z.object({ serviceId: stringIdSchema });

export async function undoCycleAction(serviceId: string): Promise<ActionState> {
  const parsed = undoSchema.safeParse({ serviceId });
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  await requireServiceManager(parsed.data.serviceId);
  try {
    await undoCycle(parsed.data.serviceId);
    revalidate(parsed.data.serviceId);
    return { ok: true };
  } catch (err) {
    if (err instanceof CycleError) return { ok: false, error: err.message };
    console.error("[exercice] undoCycle", err);
    return { ok: false, error: "Échec de l'annulation." };
  }
}
