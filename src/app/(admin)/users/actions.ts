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
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSession, requireRole } from "@/server/guards";
import { reauthOrError } from "@/server/reauth";
import {
  anonymizeUser,
  assertNotLastActiveAdmin,
  hardDeleteEmptyUser,
  RgpdError,
} from "@/server/services/rgpd";

const ROLES = ["utilisateur", "gestionnaire", "administrateur"] as const;

// Champs métier communs (création + édition). Identité : fragments partagés
// (schemas/user) — plafonds uniques avec « Mon compte » et l'inscription.
const baseUserSchema = z.object({
  prenom: prenomSchema.default(""),
  nom: nomSchema.default(""),
  tel: telSchema.default(""),
  niveau: z.string().trim().max(100).default(""),
  enfants: z.coerce.number().int().min(0).max(99).default(0),
  accompagnants: z.coerce.number().int().min(0).max(99).default(0),
  role: z.enum(ROLES),
  demandeurId: z.coerce.number().int().positive().nullable().default(null),
  structureId: z.coerce.number().int().positive().nullable().default(null),
  services: z.array(z.string().min(1)).default([]),
});

// Un compte « utilisateur » doit toujours déclarer au moins 1 enfant ET
// 1 accompagnant — à la création comme à l'édition (on ne peut pas le repasser
// sous 1/1). L'exigence ne s'applique PAS aux gestionnaires/administrateurs.
// Invariant + messages : source unique schemas/user (partagée avec l'inscription).
function requireKidsForUser(
  d: { role: string; enfants: number; accompagnants: number },
  ctx: z.RefinementCtx,
) {
  if (d.role !== "utilisateur") return;
  if (!profileCountOk(d.enfants)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["enfants"],
      message: PROFILE_MIN_ENFANTS_MSG,
    });
  }
  if (!profileCountOk(d.accompagnants)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accompagnants"],
      message: PROFILE_MIN_ACCOMPAGNANTS_MSG,
    });
  }
}

// Un gestionnaire sans service rattaché n'aurait accès à rien (ServiceManager,
// liste vide = aucun service) : on impose au moins un service à la création
// comme à l'édition. Sans objet pour les autres rôles (services vidés).
function requireServicesForManager(d: { role: string; services: string[] }, ctx: z.RefinementCtx) {
  if (d.role === "gestionnaire" && d.services.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["services"],
      message: "Sélectionnez au moins un service pour un gestionnaire.",
    });
  }
}

const updateUserSchema = baseUserSchema
  .extend({ id: z.string().min(1) })
  .superRefine(requireKidsForUser)
  .superRefine(requireServicesForManager);
const createUserSchema = baseUserSchema
  .extend({
    email: z.string().trim().pipe(z.email()),
    nom: nomSchema.min(1, "Le nom est obligatoire."),
  })
  .superRefine(requireKidsForUser)
  .superRefine(requireServicesForManager);

export type UpdateUserInput = z.input<typeof updateUserSchema>;
export type CreateUserInput = z.input<typeof createUserSchema>;

/** Synchronise la table ServiceManager (delta) pour un gestionnaire. */
async function syncManagedServices(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  serviceIds: string[],
) {
  const existing = await tx.serviceManager.findMany({
    where: { userId },
    select: { serviceId: true },
  });
  const have = new Set(existing.map((s) => s.serviceId));
  const want = new Set(serviceIds);
  const toAdd = serviceIds.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));
  if (toRemove.length) {
    await tx.serviceManager.deleteMany({ where: { userId, serviceId: { in: toRemove } } });
  }
  for (const serviceId of toAdd) {
    await tx.serviceManager.create({ data: { userId, serviceId } });
  }
}

/** Mot de passe aléatoire fort (l'admin ne le connaît jamais ; reset par lien). */
function strongRandomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${Buffer.from(bytes).toString("base64url")}Aa1!`;
}

export async function updateUserAction(
  input: UpdateUserInput,
  password?: string,
): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  const d = parsed.data;
  const isManager = d.role === "gestionnaire";

  // Rôle AVANT modification : sans cette lecture, le journal dirait « rôle
  // changé » sans pouvoir dire depuis quoi — l'information la plus utile lors
  // d'une analyse d'incident (constat BAC4).
  const before = await prisma.user.findUnique({
    where: { id: d.id },
    select: { role: true, email: true },
  });

  // Ré-authentification exigée UNIQUEMENT si le rôle change (constat BAC3) :
  // c'est le vecteur d'élévation de privilèges le plus direct. Corriger un
  // numéro de téléphone n'a pas à réclamer un mot de passe — une confirmation
  // demandée sans motif finit saisie machinalement, et ne protège plus rien.
  if (before && before.role !== d.role) {
    const refus = await reauthOrError(password);
    if (refus) return refus;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Ne pas retirer le DERNIER administrateur (constat BAC6). La suppression et
      // l'anonymisation étaient protégées ; le changement de rôle ne l'était pas —
      // or c'est le chemin le plus banal, celui d'un formulaire ordinaire.
      //
      // Uniquement quand le rôle QUITTE « administrateur » : appelé sur une simple
      // correction de fiche, le garde bloquerait le dernier administrateur qui met
      // à jour son propre numéro de téléphone.
      //
      // DANS la transaction, avant l'écriture : hors transaction, le contrôle et la
      // mise à jour pourraient être séparés par une autre opération.
      if (before?.role === "administrateur" && d.role !== "administrateur") {
        await assertNotLastActiveAdmin(tx, d.id);
      }

      await tx.user.update({
        where: { id: d.id },
        data: {
          prenom: d.prenom,
          nom: d.nom,
          name: `${d.prenom} ${d.nom}`.trim(),
          tel: d.tel,
          niveau: d.niveau,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
          role: d.role,
          demandeurId: d.demandeurId,
          structureId: d.structureId,
        },
      });
      // Hors gestionnaire : aucun service nominatif → on vide la liste.
      await syncManagedServices(tx, d.id, isManager ? d.services : []);
    });
  } catch (e) {
    // Le refus du garde-fou porte un message UTILISABLE (« c'est le dernier
    // administrateur actif »). Le noyer dans « Échec de la mise à jour » laisserait
    // l'administrateur devant un échec inexplicable, qu'il retenterait.
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    console.error("[users] updateUserAction", e);
    return { ok: false, error: "Échec de la mise à jour du compte." };
  }

  // Un changement de rôle est le vecteur d'élévation de privilèges le plus
  // direct : il a sa propre entrée, distincte d'une simple mise à jour de fiche.
  if (before && before.role !== d.role) {
    await recordAudit(AUDIT.USER_ROLE_CHANGED, {
      target: before.email,
      details: { avant: before.role, apres: d.role, services: isManager ? d.services : [] },
    });
  } else {
    await recordAudit(AUDIT.USER_UPDATED, { target: before?.email ?? d.id });
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function createUserAction(input: CreateUserInput): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  const d = parsed.data;
  const isManager = d.role === "gestionnaire";

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: d.email,
        password: strongRandomPassword(),
        name: `${d.prenom} ${d.nom}`.trim(),
      },
    });
    userId = res.user.id;
  } catch (e) {
    console.error("[users] createUserAction signUpEmail", e);
    return { ok: false, error: "Impossible de créer le compte (e-mail déjà utilisé ?)." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          prenom: d.prenom,
          nom: d.nom,
          tel: d.tel,
          niveau: d.niveau,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
          role: d.role,
          demandeurId: d.demandeurId,
          structureId: d.structureId,
          rgpdOk: true,
        },
      });
      await syncManagedServices(tx, userId, isManager ? d.services : []);
    });
  } catch (e) {
    console.error("[users] createUserAction champs métier", e);
    return {
      ok: false,
      error: "Compte créé mais les informations métier n'ont pas pu être enregistrées.",
    };
  }

  await recordAudit(AUDIT.USER_CREATED, { target: d.email, details: { role: d.role } });

  // La personne choisit elle-même son mot de passe via le lien reçu.
  try {
    await auth.api.requestPasswordReset({
      body: { email: d.email, redirectTo: "/auth/reset-password" },
    });
  } catch {
    // Non bloquant : le compte existe, l'admin pourra renvoyer un lien.
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function anonymizeUserAction(id: string, password: string): Promise<ActionState> {
  await requireRole("administrateur");
  // Anonymisation IRRÉVERSIBLE (constat BAC3).
  const refus = await reauthOrError(password);
  if (refus) return refus;
  const parsed = z.string().min(1).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Compte introuvable" };
  const cible = await prisma.user.findUnique({
    where: { id: parsed.data },
    select: { email: true },
  });
  try {
    await anonymizeUser(parsed.data, "admin");
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de l'anonymisation." };
  }
  // Anonymisation : déjà inscrite au registre RGPD (finalité juridique). On la
  // reporte ici pour que le journal opérationnel donne une vue complète des
  // actes privilégiés sans obliger à croiser deux sources.
  await recordAudit(AUDIT.USER_DELETED, {
    target: cible?.email ?? parsed.data,
    details: { mode: "anonymisation" },
  });
  revalidatePath("/users");
  return { ok: true };
}

/** Suppression physique d'un compte VIDE (0 réservation) — cf. `hardDeleteEmptyUser`. */
// Sans ré-authentification : ne vise que les comptes SANS réservation (test, spam
// d inscription). Exiger un mot de passe pour un acte à si faible portée diluerait
// la confirmation là où elle compte vraiment (constat BAC3).
export async function deleteEmptyUserAction(id: string): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = z.string().min(1).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Compte introuvable" };
  const session = await getSession();
  const actorId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const victime = await prisma.user.findUnique({
    where: { id: parsed.data },
    select: { email: true },
  });
  try {
    await hardDeleteEmptyUser(parsed.data, actorId);
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, error: e.message };
    return { ok: false, error: "Échec de la suppression." };
  }
  await recordAudit(AUDIT.USER_DELETED, {
    target: victime?.email ?? parsed.data,
    details: { mode: "suppression definitive" },
  });
  revalidatePath("/users");
  return { ok: true };
}

export async function resendVerificationAction(email: string): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = z.email().safeParse(email);
  if (!parsed.success) return { ok: false, error: "E-mail invalide" };
  try {
    await auth.api.sendVerificationEmail({ body: { email: parsed.data, callbackURL: "/" } });
  } catch {
    return { ok: false, error: "Échec de l'envoi du mail de confirmation." };
  }
  return { ok: true };
}

export async function sendPasswordResetAction(email: string): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = z.email().safeParse(email);
  if (!parsed.success) return { ok: false, error: "E-mail invalide" };
  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data, redirectTo: "/auth/reset-password" },
    });
  } catch {
    return { ok: false, error: "Échec de l'envoi du lien de réinitialisation." };
  }
  return { ok: true };
}

/**
 * Réinitialise le second facteur d'un compte (constat A6) — le filet de sécurité.
 *
 * Sans lui, un gestionnaire qui perd à la fois son téléphone ET ses codes de
 * secours serait définitivement enfermé dehors : son rôle lui interdit de
 * désactiver la double authentification lui-même. Un administrateur peut donc la
 * retirer, après quoi la personne se réenrôle à sa prochaine visite.
 *
 * ⚠️ SI LE DERNIER ADMINISTRATEUR SE VERROUILLE, plus personne ne peut exécuter
 * cette action. Le seul recours est alors la base de données :
 *
 *   DELETE FROM two_factor WHERE user_id = '<id>';
 *   UPDATE "user" SET two_factor_enabled = false WHERE id = '<id>';
 *
 * C'est la raison d'être des codes de secours, et pourquoi l'écran d'enrôlement
 * insiste pour qu'ils soient conservés AILLEURS que sur le téléphone.
 *
 * La procédure complète — compte de secours désigné, conservation des codes hors
 * ligne, et les commandes exactes du recours en base — vit dans DEPLOY.md,
 * « Reprise en main si les administrateurs sont verrouillés » : un exploitant sous
 * pression cherche dans la documentation d'exploitation, pas dans un commentaire de
 * code auquel il n'a peut-être pas accès.
 */
export async function resetTwoFactorAction(id: string, password: string): Promise<ActionState> {
  await requireRole("administrateur");
  // Retirer un second facteur ABAISSE la protection d'un compte privilégié : c'est
  // précisément le geste qu'un attaquant tenterait en premier (constat BAC3).
  const refus = await reauthOrError(password);
  if (refus) return refus;
  const parsed = z.string().min(1).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Compte introuvable" };

  const cible = await prisma.user.findUnique({
    where: { id: parsed.data },
    select: { email: true, twoFactorEnabled: true },
  });
  if (!cible) return { ok: false, error: "Compte introuvable" };
  if (!cible.twoFactorEnabled) {
    return { ok: false, error: "La double authentification n'est pas active sur ce compte." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.twoFactor.deleteMany({ where: { userId: parsed.data } });
      await tx.user.update({ where: { id: parsed.data }, data: { twoFactorEnabled: false } });
    });
  } catch (e) {
    console.error("[users] resetTwoFactorAction", e);
    return { ok: false, error: "Échec de la réinitialisation." };
  }

  // Retirer un second facteur ABAISSE le niveau de protection d'un compte
  // privilégié : l'acte doit laisser une trace au même titre qu'un changement de
  // rôle (constat BAC4).
  await recordAudit(AUDIT.USER_2FA_RESET, { target: cible.email });
  revalidatePath("/users");
  return { ok: true };
}
