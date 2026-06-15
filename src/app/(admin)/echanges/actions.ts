"use server";

import type { ActionState } from "@/lib/action-state";
import { requireRole, requireServiceManager } from "@/server/guards";
import { MAIL_KINDS, type MailKind, setMailEnabled } from "@/server/services/mail-prefs";
import {
  TEMPLATE_KINDS,
  type TemplateKind,
  setMailTemplate,
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

/** Active/désactive l'envoi d'un type d'e-mail (par service si `serviceId`). */
export async function setMailPrefAction(
  kind: string,
  enabled: boolean,
  serviceId?: string,
): Promise<ActionState> {
  // Seuls les e-mails de réservation ont un réglage « Envoyer » ; ils sont par service.
  if (!isBookingKind(kind)) return { ok: false, error: "Type d'e-mail inconnu." };
  await authorizeScope(serviceId);
  await setMailEnabled(kind as MailKind, enabled, serviceId);
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
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  // Réservation → uniquement par service ; système → uniquement global. Empêche d'écrire
  // un gabarit dans une portée où il ne serait jamais lu.
  if (isBookingKind(kind) !== Boolean(serviceId)) {
    return { ok: false, error: "Portée invalide pour ce type d'e-mail." };
  }
  if (typeof subject !== "string" || typeof html !== "string") {
    return { ok: false, error: "Contenu invalide." };
  }
  if (subject.length > 500 || html.length > 50000) {
    return { ok: false, error: "Contenu trop long." };
  }
  await authorizeScope(serviceId);
  await setMailTemplate(kind as TemplateKind, subject, html, serviceId);
  revalidateScope(serviceId);
  return { ok: true };
}
