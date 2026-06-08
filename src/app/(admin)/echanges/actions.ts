"use server";

import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/server/guards";
import { MAIL_KINDS, type MailKind, setMailEnabled } from "@/server/services/mail-prefs";
import {
  TEMPLATE_KINDS,
  type TemplateKind,
  setMailTemplate,
} from "@/server/services/mail-templates";
import { revalidatePath } from "next/cache";

/** Active/désactive l'envoi d'un type d'e-mail (écran Échanges). */
export async function setMailPrefAction(kind: string, enabled: boolean): Promise<ActionState> {
  await requireRole("administrateur");
  if (!(MAIL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  await setMailEnabled(kind as MailKind, enabled);
  revalidatePath("/echanges");
  return { ok: true };
}

/** Enregistre le gabarit (sujet + corps HTML) d'un type d'e-mail. */
export async function setMailTemplateAction(
  kind: string,
  subject: string,
  html: string,
): Promise<ActionState> {
  await requireRole("administrateur");
  if (!(TEMPLATE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "Type d'e-mail inconnu." };
  }
  if (typeof subject !== "string" || typeof html !== "string") {
    return { ok: false, error: "Contenu invalide." };
  }
  if (subject.length > 500 || html.length > 50000) {
    return { ok: false, error: "Contenu trop long." };
  }
  await setMailTemplate(kind as TemplateKind, subject, html);
  revalidatePath("/echanges");
  return { ok: true };
}
