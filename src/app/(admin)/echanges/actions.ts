"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { adressesFixesSchema, mailTemplateSchema, mailTypeMetaSchema } from "@/schemas/echanges";
import { requireRole, requireServiceManager } from "@/server/guards";
import {
  isBookingTrigger,
  isMailRecipientKind,
  MAIL_KINDS,
  type MailRecipientKind,
  setTriggerEnabled,
  setTriggerKind,
  setTriggerRecipient,
} from "@/server/services/mail-prefs";
import {
  createCustomMailType,
  deleteCustomMailType,
  isCustomMailType,
  isCustomMailTypeUsed,
  setMailTemplate,
  TEMPLATE_KINDS,
  updateCustomMailType,
} from "@/server/services/mail-templates";
import {
  MAX_VALIDATION_NOTICE_DELAY,
  setValidationNoticeDelay,
} from "@/server/services/validation-notice";

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
  else revalidatePath("/echanges");
}

/**
 * Active/désactive l'envoi d'e-mail pour une ACTION précise (déclencheur), GLOBALEMENT.
 * Permet de couper l'e-mail sur une action sans toucher aux autres qui partagent le même
 * type (ex. désactiver l'auto-validation tout en gardant la validation manuelle).
 */
export async function setMailTriggerAction(
  trigger: string,
  enabled: boolean,
): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  await requireRole("administrateur");
  await setTriggerEnabled(trigger, enabled);
  revalidatePath("/echanges");
  return { ok: true };
}

/**
 * Délai de regroupement des notifications de validation (minutes, global) : 0 = envoi
 * immédiat à chaque clic ; sinon seul l'état final est notifié après ce délai (cf.
 * services/validation-notice).
 */
export async function setValidationNoticeDelayAction(minutes: number): Promise<ActionState> {
  await requireRole("administrateur");
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_VALIDATION_NOTICE_DELAY) {
    return { ok: false, error: `Délai invalide (0 à ${MAX_VALIDATION_NOTICE_DELAY} minutes).` };
  }
  await setValidationNoticeDelay(minutes);
  revalidatePath("/echanges");
  return { ok: true };
}

/** Re-route une action vers un autre type d'e-mail (menu « Type d'e-mail », global). */
export async function setTriggerKindAction(trigger: string, kind: string): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  // Autorisation AVANT toute requête en base (la validation de la cible fait un I/O DB).
  await requireRole("administrateur");
  // Cible valide : type intégré OU type personnalisé GLOBAL (le routage est global).
  if (!isBookingKind(kind) && !(await isCustomMailType(kind))) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  await setTriggerKind(trigger, kind);
  revalidatePath("/echanges");
  return { ok: true };
}

/** Définit le destinataire d'une action (menu « Destinataire », global). */
export async function setTriggerRecipientAction(
  trigger: string,
  kind: string,
  addr: string,
): Promise<ActionState> {
  if (!isBookingTrigger(trigger)) return { ok: false, error: "Action inconnue." };
  if (!isMailRecipientKind(kind)) return { ok: false, error: "Destinataire inconnu." };

  // Seul le mode « adresse(s) fixe(s) » exploite l'adresse : `setTriggerRecipient`
  // enregistre une chaîne vide pour tous les autres. On ne valide donc que ce cas,
  // et l'on passe "" ailleurs — strictement équivalent au comportement antérieur.
  let cleanAddr = "";
  if (kind === "fixe") {
    const parsed = adressesFixesSchema.safeParse(addr ?? "");
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Adresse invalide." };
    }
    cleanAddr = parsed.data;
  }
  await requireRole("administrateur");
  await setTriggerRecipient(trigger, kind as MailRecipientKind, cleanAddr);
  revalidatePath("/echanges");
  return { ok: true };
}

/** Enregistre le gabarit (sujet + corps HTML) d'un type d'e-mail. */
export async function setMailTemplateAction(
  kind: string,
  subject: string,
  html: string,
  serviceId?: string,
): Promise<ActionState> {
  // Autorisation AVANT toute requête en base (la résolution du type custom fait un I/O DB).
  await authorizeScope(serviceId);
  const builtin = (TEMPLATE_KINDS as readonly string[]).includes(kind);
  // Custom : serviceId présent → type DU SERVICE ; absent → type GLOBAL (admin).
  const custom = !builtin && (await isCustomMailType(kind, serviceId));
  if (!builtin && !custom) return { ok: false, error: "Type d'e-mail inconnu." };
  // Portée des types INTÉGRÉS : système (non réservation) = GLOBAL uniquement ;
  // réservation = GLOBAL (admin, base tous services) OU par service (surcharge).
  if (builtin && !isBookingKind(kind) && serviceId) {
    return { ok: false, error: "Portée invalide pour ce type d'e-mail." };
  }
  const contenu = mailTemplateSchema.safeParse({ subject, html });
  if (!contenu.success) {
    return { ok: false, error: contenu.error.issues[0]?.message ?? "Contenu invalide." };
  }
  await setMailTemplate(kind, contenu.data.subject, contenu.data.html, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}

/**
 * Crée un type d'e-mail PERSONNALISÉ GLOBAL (« tous services », admin uniquement). La création
 * de types PAR SERVICE est abolie : un service ne fait que surcharger le contenu des types
 * globaux (cf. « Modèles d'e-mails » d'un service).
 */
export async function createMailTypeAction(
  serviceId: string | undefined,
  label: string,
  description = "",
  recipient = "",
): Promise<ActionState> {
  // Les types personnalisés sont désormais GLOBAUX uniquement (centralisés en administration).
  if (serviceId)
    return { ok: false, error: "Les types personnalisés se créent en administration." };
  await authorizeScope(serviceId);
  const meta = mailTypeMetaSchema.safeParse({ label, description, recipient });
  if (!meta.success) {
    return { ok: false, error: meta.error.issues[0]?.message ?? "Champ invalide." };
  }
  await createCustomMailType(
    serviceId,
    meta.data.label,
    meta.data.description,
    meta.data.recipient || undefined,
  );
  revalidateScope(serviceId);
  return { ok: true };
}

/**
 * Modifie nom / description d'un type d'e-mail.
 *  - type PERSONNALISÉ (service → gestionnaire ; global → admin) ;
 *  - type INTÉGRÉ : métadonnées éditables uniquement au niveau GLOBAL (admin, serviceId omis) —
 *    la clé reste fixe (contrat code), seuls le libellé/la description changent.
 */
export async function updateMailTypeAction(
  serviceId: string | undefined,
  key: string,
  label: string,
  description: string,
  recipient: string,
): Promise<ActionState> {
  await authorizeScope(serviceId);
  const isCustom = await isCustomMailType(key, serviceId);
  const isBuiltinGlobal = !serviceId && (TEMPLATE_KINDS as readonly string[]).includes(key);
  if (!isCustom && !isBuiltinGlobal) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  const meta = mailTypeMetaSchema.safeParse({ label, description, recipient });
  if (!meta.success) {
    return { ok: false, error: meta.error.issues[0]?.message ?? "Champ invalide." };
  }
  await updateCustomMailType(serviceId, key, meta.data);
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
