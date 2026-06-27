"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { requireServiceManager } from "@/server/guards";
import { anonymizeUser, isUserInServicesRgpdScope, RgpdError } from "@/server/services/rgpd";

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

  // Anti-IDOR : la cible doit relever du périmètre RGPD de CE service (rôle
  // utilisateur, demandeur effectif configuré pour le service) — un gestionnaire
  // ne peut pas anonymiser un compte hors de son périmètre via un userId arbitraire.
  if (!(await isUserInServicesRgpdScope([serviceId], userId))) {
    return { ok: false, error: "Usager hors du périmètre de ce service." };
  }

  try {
    await anonymizeUser(userId, "admin");
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/services/${serviceId}/rgpd`);
  return { ok: true };
}
