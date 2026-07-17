"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { stringIdSchema } from "@/schemas/config";
import { requireServiceManager } from "@/server/guards";
import { saveServiceThemes } from "@/server/services/themes";

const saveThemesSchema = z.object({
  serviceId: stringIdSchema,
  mode: z.enum(["libre", "liste"]),
  themes: z.array(z.string().max(255)).max(500),
});

type SaveThemesInput = z.infer<typeof saveThemesSchema>;

/** Enregistre le mode + la liste de thèmes d'un service (sous-onglet Paramètres → Thèmes). */
export async function saveThemesAction(input: SaveThemesInput): Promise<ActionState> {
  const parsed = saveThemesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, mode, themes } = parsed.data;
  await requireServiceManager(serviceId);
  try {
    await saveServiceThemes(serviceId, mode, themes);
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  // Consommée par le panneau Configuration (l'onglet Thèmes dédié a été supprimé).
  revalidatePath(`/services/${serviceId}/config`);
  return { ok: true };
}
