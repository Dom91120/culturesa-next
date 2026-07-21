"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  nomSchema,
  PROFILE_MIN_ACCOMPAGNANTS_MSG,
  PROFILE_MIN_ENFANTS_MSG,
  prenomSchema,
  profileCountOk,
  telSchema,
} from "@/schemas/user";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { rateLimit } from "@/server/rate-limit";
import { requestAccountDeletion } from "@/server/services/account-deletion";
import { RgpdError } from "@/server/services/rgpd";

// Identité : fragments partagés (schemas/user) — les plafonds locaux (80) divergeaient
// de l'admin (100) : un prénom saisi par l'admin devenait non ré-enregistrable ici.
const schema = z.object({
  prenom: prenomSchema,
  nom: nomSchema,
  tel: telSchema,
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

  const data = {
    prenom: parsed.data.prenom,
    nom: parsed.data.nom,
    tel: parsed.data.tel,
    name: `${parsed.data.prenom} ${parsed.data.nom}`.trim(),
  } as {
    prenom: string;
    nom: string;
    tel: string;
    name: string;
    enfants?: number;
    accompagnants?: number;
  };

  // Nb enfants / accompagnants : éditables seulement pour les comptes « utilisateur »
  // (invariant ≥ 1, partagé avec l'inscription et l'admin). Le rôle fait foi en base :
  // on ignore ces champs pour un gestionnaire/administrateur, même s'ils sont postés.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (dbUser?.role === "utilisateur") {
    const enfants = Number(formData.get("enfants"));
    const accompagnants = Number(formData.get("accompagnants"));
    if (!profileCountOk(enfants)) return { ok: false, error: PROFILE_MIN_ENFANTS_MSG };
    if (!profileCountOk(accompagnants)) return { ok: false, error: PROFILE_MIN_ACCOMPAGNANTS_MSG };
    data.enfants = enfants;
    data.accompagnants = accompagnants;
  }

  await prisma.user.update({ where: { id: session.user.id }, data });
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
