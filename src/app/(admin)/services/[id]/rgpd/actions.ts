"use server";

import type { ActionState } from "@/lib/action-state";
import { requireServiceManager } from "@/server/guards";
import { RgpdError, anonymizeUser } from "@/server/services/rgpd";
import { revalidatePath } from "next/cache";

/**
 * Anonymise un usager DU SERVICE depuis le sous-onglet Paramètres › RGPD.
 *
 * Délègue à `anonymizeUser` (raison `admin`) : vide les données personnelles
 * identifiantes et verrouille le compte, tout en conservant l'enregistrement
 * (historique des réservations). Irréversible.
 */
export async function anonymizeServiceUserAction(
  serviceId: string,
  userId: string,
): Promise<ActionState> {
  await requireServiceManager(serviceId);
  if (!userId) return { ok: false, error: "Usager cible manquant." };

  try {
    await anonymizeUser(userId, "admin");
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/services/${serviceId}/rgpd`);
  return { ok: true };
}
