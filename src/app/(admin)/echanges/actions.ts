"use server";

import type { ActionState } from "@/lib/action-state";
import { requireRole, requireServiceManager } from "@/server/guards";
import {
  MAIL_KINDS,
  type MailRecipientKind,
  isBookingTrigger,
  isMailRecipientKind,
  setTriggerEnabled,
  setTriggerKind,
  setTriggerRecipient,
} from "@/server/services/mail-prefs";
import {
  TEMPLATE_KINDS,
  createCustomMailType,
  deleteCustomMailType,
  isCustomMailType,
  isCustomMailTypeUsed,
  setMailTemplate,
  updateCustomMailType,
} from "@/server/services/mail-templates";
import { revalidatePath } from "next/cache";

const isBookingKind = (kind: string) => (MAIL_KINDS as readonly string[]).includes(kind);

/**
 * Garde + revalidation selon la portée :
 *  - `serviceId` fourni → e-mail de réservation, réglé PAR SERVICE (gestionnaire du service) ;
 *  - sans `serviceId` → e-mail système, réglé GLOBALEMENT (administrateur).
 */
async function authorizeScope(serviceId: string | undefined): Promise<void> {
  if (serviceId) await requireServiceManager(serviceId);
  else await requireRole("administrateur");
}
function revalidateScope(serviceId: string | undefined): void {
  if (serviceId) revalidatePath(`/services/${serviceId}/echanges`);
  else revalidatePath("/messagerie");
}

/**
 * Active/désactive l'envoi d'e-mail pour une ACTION précise (déclencheur), par service.
 * Permet de couper l'e-mail sur une action sans toucher aux autres qui partagent le même
 * type (ex. désactiver l'auto-validation tout en gardant la validation manuelle).
 */
export async function setMailTriggerAction(
  trigger: string,
  enabled: boolean,
  serviceId?: string,
): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  // Les déclencheurs de réservation sont réglés PAR SERVICE.
  if (!serviceId) return { ok: false, error: "Service requis." };
  await authorizeScope(serviceId);
  await setTriggerEnabled(trigger, enabled, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}

/** Re-route une action vers un autre type d'e-mail (menu « Type d'e-mail », par service). */
export async function setTriggerKindAction(
  trigger: string,
  kind: string,
  serviceId?: string,
): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  if (!serviceId) return { ok: false, error: "Service requis." };
  // Cible valide : type intégré OU type personnalisé de CE service.
  if (!isBookingKind(kind) && !(await isCustomMailType(kind, serviceId))) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  await authorizeScope(serviceId);
  await setTriggerKind(trigger, kind, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}

/** Définit le destinataire d'une action (menu « Destinataire », par service). */
export async function setTriggerRecipientAction(
  trigger: string,
  kind: string,
  addr: string,
  serviceId?: string,
): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  if (!serviceId) return { ok: false, error: "Service requis." };
  if (!isMailRecipientKind(kind)) return { ok: false, error: "Destinataire inconnu." };
  // Pour « adresse(s) fixe(s) » : au moins une adresse valide requise.
  const cleanAddr = (addr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.includes("@"))
    .join(", ");
  if (kind === "fixe" && cleanAddr === "") {
    return { ok: false, error: "Renseignez au moins une adresse e-mail valide." };
  }
  await authorizeScope(serviceId);
  await setTriggerRecipient(trigger, kind as MailRecipientKind, cleanAddr, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}

/** Enregistre le gabarit (sujet + corps HTML) d'un type d'e-mail. */
export async function setMailTemplateAction(
  kind: string,
  subject: string,
  html: string,
  serviceId?: string,
): Promise<ActionState> {
  const builtin = (TEMPLATE_KINDS as readonly string[]).includes(kind);
  // Custom : serviceId présent → type DU SERVICE ; absent → type GLOBAL (admin).
  const custom = !builtin && (await isCustomMailType(kind, serviceId));
  if (!builtin && !custom) return { ok: false, error: "Type d'e-mail inconnu." };
  // Portée des types INTÉGRÉS : système (non réservation) = GLOBAL uniquement ;
  // réservation = GLOBAL (admin, base tous services) OU par service (surcharge).
  if (builtin && !isBookingKind(kind) && serviceId) {
    return { ok: false, error: "Portée invalide pour ce type d'e-mail." };
  }
  if (typeof subject !== "string" || typeof html !== "string") {
    return { ok: false, error: "Contenu invalide." };
  }
  if (subject.length > 500 || html.length > 50000) {
    return { ok: false, error: "Contenu trop long." };
  }
  await authorizeScope(serviceId);
  await setMailTemplate(kind, subject, html, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}

/**
 * Crée un type d'e-mail PERSONNALISÉ. `serviceId` fourni → type du service (gestionnaire du
 * service ou admin) ; omis → type GLOBAL « tous services » (admin uniquement).
 */
export async function createMailTypeAction(
  serviceId: string | undefined,
  label: string,
  description = "",
  recipient = "",
): Promise<ActionState> {
  await authorizeScope(serviceId);
  const l = (label ?? "").trim();
  if (!l) return { ok: false, error: "Libellé requis." };
  if (l.length > 100 || (description ?? "").length > 300 || (recipient ?? "").length > 200) {
    return { ok: false, error: "Champ trop long." };
  }
  const d = (description ?? "").trim();
  const r = (recipient ?? "").trim();
  await createCustomMailType(serviceId, l, d, r || undefined);
  revalidateScope(serviceId);
  return { ok: true };
}

/** Modifie nom / description d'un type personnalisé (service → gestionnaire ; global → admin). */
export async function updateMailTypeAction(
  serviceId: string | undefined,
  key: string,
  label: string,
  description: string,
  recipient: string,
): Promise<ActionState> {
  await authorizeScope(serviceId);
  if (!(await isCustomMailType(key, serviceId))) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  const l = (label ?? "").trim();
  if (!l) return { ok: false, error: "Libellé requis." };
  if (l.length > 100 || (description ?? "").length > 300 || (recipient ?? "").length > 200) {
    return { ok: false, error: "Champ trop long." };
  }
  await updateCustomMailType(serviceId, key, {
    label: l,
    description: (description ?? "").trim(),
    recipient: (recipient ?? "").trim(),
  });
  revalidateScope(serviceId);
  return { ok: true };
}

/**
 * Supprime un type d'e-mail personnalisé (service → gestionnaire ; global → admin) —
 * uniquement s'il n'est routé par AUCUNE action (sinon on enverrait un type inexistant).
 */
export async function deleteMailTypeAction(
  serviceId: string | undefined,
  key: string,
): Promise<ActionState> {
  await authorizeScope(serviceId);
  if (!(await isCustomMailType(key, serviceId))) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  if (await isCustomMailTypeUsed(key, serviceId)) {
    return {
      ok: false,
      error: serviceId
        ? "Ce type est utilisé par une action du service ; retirez-le d'abord."
        : "Ce type est utilisé par au moins un service ; retirez-le d'abord.",
    };
  }
  await deleteCustomMailType(serviceId, key);
  revalidateScope(serviceId);
  return { ok: true };
}
