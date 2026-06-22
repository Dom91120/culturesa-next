"use server";

import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { rateLimit } from "@/server/rate-limit";
import { requestAccountDeletion } from "@/server/services/account-deletion";
import { RgpdError } from "@/server/services/rgpd";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const schema = z.object({
  prenom: z.string().trim().max(80),
  nom: z.string().trim().max(80),
  tel: z.string().trim().max(30),
});

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const parsed = schema.safeParse({
    prenom: formData.get("prenom"),
    nom: formData.get("nom"),
    tel: formData.get("tel"),
  });
  if (!parsed.success) return { ok: false, error: "Données invalides." };

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      prenom: parsed.data.prenom,
      nom: parsed.data.nom,
      tel: parsed.data.tel,
      name: `${parsed.data.prenom} ${parsed.data.nom}`.trim(),
    },
  });
  revalidatePath("/mon-compte");
  return { ok: true };
}

/**
 * Demande de suppression de compte (RGPD art. 17) : envoie à l'usager connecté un
 * e-mail avec un lien de confirmation valable 24 h. La suppression effective a lieu
 * seulement après clic sur ce lien (cf. /supprimer-compte).
 */
export async function requestAccountDeletionAction(): Promise<ActionState> {
  const session = await requireUser();
  // Anti-abus : chaque appel envoie un e-mail. On limite à 3 demandes / 15 min par usager
  // (l'endpoint est une server action, hors du rate-limit Better Auth des routes /api/auth).
  if (!rateLimit(`acct-del:${session.user.id}`, 3, 15 * 60_000)) {
    return { ok: false, error: "Trop de demandes. Réessayez dans quelques minutes." };
  }
  try {
    await requestAccountDeletion(session.user.id);
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true };
}
