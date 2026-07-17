"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { stringIdSchema } from "@/schemas/config";
import { requireServiceManager } from "@/server/guards";
import { cycleService, setShowPreviousExercices, undoCycle } from "@/server/services/exercice";

/** Variante d'ActionState renvoyant les compteurs du cycle. */
export type CycleActionState =
  | { ok: true; created: number; slotsCreated: number }
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
    return { ok: false, error: err instanceof Error ? err.message : "Échec de l'enregistrement." };
  }
}

const cycleSchema = z.object({
  serviceId: stringIdSchema,
  recreatePeriods: z.boolean(),
  recreateSlots: z.boolean(),
});

export async function cycleAction(
  serviceId: string,
  recreatePeriods: boolean,
  recreateSlots: boolean,
): Promise<CycleActionState> {
  const parsed = cycleSchema.safeParse({ serviceId, recreatePeriods, recreateSlots });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Valeurs invalides." };
  }
  await requireServiceManager(parsed.data.serviceId);
  try {
    const res = await cycleService(parsed.data.serviceId, {
      recreatePeriods: parsed.data.recreatePeriods,
      recreateSlots: parsed.data.recreateSlots,
    });
    revalidate(parsed.data.serviceId);
    return { ok: true, created: res.created, slotsCreated: res.slotsCreated };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Échec du cycle." };
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
    return { ok: false, error: err instanceof Error ? err.message : "Échec de l'annulation." };
  }
}
