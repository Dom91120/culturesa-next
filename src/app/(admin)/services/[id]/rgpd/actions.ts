"use server";

import type { ActionState } from "@/lib/action-state";
import { requireServiceManager } from "@/server/guards";
import { anonymizeUser } from "@/server/services/rgpd";
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

  await anonymizeUser(userId, "admin");
  revalidatePath(`/services/${serviceId}/rgpd`);
  return { ok: true };
}
