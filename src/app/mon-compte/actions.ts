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
import { AUDIT, recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { rateLimit } from "@/server/rate-limit";
import { requestAccountDeletion } from "@/server/services/account-deletion";
import { RgpdError } from "@/server/services/rgpd";
import { aReservationSurExerciceCourant } from "@/server/services/structures";

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
 * Changement de CATÉGORIE et de STRUCTURE par l'usager lui-même.
 *
 * ── Pourquoi c'est acceptable ──
 * La catégorie commande l'accès aux services, les créneaux ouverts, le mode
 * validation, le thème obligatoire et l'ouverture pendant les vacances. La laisser
 * changer semble donc une élévation de privilège — mais elle est DÉJÀ auto-déclarée :
 * le formulaire d'inscription publique fait choisir sa catégorie librement. Refuser
 * ici ne protégerait rien (il suffirait de recréer un compte) ; cela obligerait juste
 * l'usager qui déménage d'école à écrire au service. Ce qui protège réellement reste
 * en place : le mode validation par demandeur, et le verrou `/update-user` qui
 * interdit d'écrire ces champs par la porte de derrière (audit 2026-07-14) — ce
 * changement passe par CETTE action, avec ses contrôles.
 *
 * ── La condition ──
 * Aucune réservation sur un exercice EN COURS. Catégorie et structure sont lues à
 * l'affichage (agenda, éditions, statistiques, exports), jamais figées sur la
 * réservation : en changer alors que des séances de l'année sont posées les
 * réétiquetterait rétroactivement — une feuille de pointage de septembre afficherait
 * la nouvelle école. Tant qu'il n'y a rien à réétiqueter, le changement est net.
 *
 * Contrôles revérifiés ICI : le formulaire les applique déjà, mais une server action
 * voit des entrées brutes.
 */
export async function updateAffiliationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireUser();
  const entier = (v: FormDataEntryValue | null): number | null => {
    const brut = String(v ?? "").trim();
    if (brut === "") return null;
    const n = Number.parseInt(brut, 10);
    return Number.isInteger(n) && n > 0 ? n : Number.NaN;
  };
  const demandeurId = entier(formData.get("demandeurId"));
  const structureId = entier(formData.get("structureId"));
  if (Number.isNaN(demandeurId) || Number.isNaN(structureId)) {
    return { ok: false, error: "Valeurs invalides." };
  }

  if (await aReservationSurExerciceCourant(session.user.id)) {
    return {
      ok: false,
      error:
        "Vous avez des réservations sur l'exercice en cours : contactez le service pour changer de catégorie ou de structure.",
    };
  }

  // La catégorie doit exister (id forgé → 400 propre plutôt qu'une violation de FK).
  if (demandeurId !== null) {
    const existe = await prisma.demandeur.findUnique({
      where: { id: demandeurId },
      select: { id: true },
    });
    if (!existe) return { ok: false, error: "Catégorie inconnue." };
  }
  // La structure doit appartenir à la catégorie choisie : sans ce contrôle, on
  // pourrait se rattacher à l'école d'une autre catégorie, et le demandeur EFFECTIF
  // (repli sur la structure) ne serait plus celui affiché.
  if (structureId !== null) {
    const st = await prisma.structure.findUnique({
      where: { id: structureId },
      select: { demandeurId: true },
    });
    if (!st) return { ok: false, error: "Structure inconnue." };
    if (demandeurId !== null && st.demandeurId !== demandeurId) {
      return { ok: false, error: "Cette structure n'appartient pas à la catégorie choisie." };
    }
  }

  const avant = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      email: true,
      demandeur: { select: { label: true } },
      structure: { select: { label: true } },
    },
  });
  await prisma.user.update({
    where: { id: session.user.id },
    data: { demandeurId, structureId },
  });
  const apres = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { demandeur: { select: { label: true } }, structure: { select: { label: true } } },
  });
  // Trace : un changement d'affiliation déplace l'accès aux services. Il est fait par
  // l'usager, donc sans regard d'un gestionnaire — le journal est le seul endroit où
  // il reste visible.
  await recordAudit(AUDIT.USER_AFFILIATION_CHANGED, {
    target: avant?.email ?? session.user.id,
    details: {
      avant: {
        categorie: avant?.demandeur?.label ?? null,
        structure: avant?.structure?.label ?? null,
      },
      apres: {
        categorie: apres?.demandeur?.label ?? null,
        structure: apres?.structure?.label ?? null,
      },
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
  if (!(await rateLimit(`acct-del:${session.user.id}`, 3, 15 * 60_000))) {
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
