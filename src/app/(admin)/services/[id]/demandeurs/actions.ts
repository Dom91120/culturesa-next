"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { stringIdSchema } from "@/schemas/config";
import { requireServiceManager } from "@/server/guards";
import {
  type DemandeurSettingRow,
  saveServiceDemandeurSettings,
} from "@/server/services/demandeur-settings";

const rowSchema = z.object({
  demandeurId: z.number().int(),
  validation: z.boolean(),
  themes: z.boolean(),
});

const saveSchema = z.object({
  serviceId: stringIdSchema,
  rows: z.array(rowSchema).max(500),
});

type SaveDemandeurSettingsInput = {
  serviceId: string;
  rows: DemandeurSettingRow[];
};

/**
 * Enregistre la matrice des demandeurs d'un service (sous-onglet Paramètres →
 * Demandeurs). Remplace toute la matrice (delete-all + recreate côté serveur).
 */
export async function saveDemandeurSettingsAction(
  input: SaveDemandeurSettingsInput,
): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, rows } = parsed.data;
  try {
    await saveServiceDemandeurSettings(serviceId, rows);
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  // Consommée par le panneau Configuration (l'onglet Demandeurs dédié a été supprimé).
  revalidatePath(`/services/${serviceId}/config`);
  return { ok: true };
}
