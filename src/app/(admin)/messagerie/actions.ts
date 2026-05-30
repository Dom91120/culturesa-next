"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { setConfig } from "@/server/config";
import { requireRole } from "@/server/guards";
import { sendMail } from "@/server/mailer";

const schema = z.object({
  senderName: z.string().trim().max(120),
  signature: z.string().trim().max(2000),
});

export async function saveMessagingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = schema.safeParse({
    senderName: formData.get("senderName"),
    signature: formData.get("signature"),
  });
  if (!parsed.success) return { ok: false, error: "Données invalides." };

  await setConfig("mail.senderName", parsed.data.senderName);
  await setConfig("mail.signature", parsed.data.signature);
  revalidatePath("/messagerie");
  return { ok: true };
}

export async function sendTestEmailAction(): Promise<ActionState> {
  const session = await requireRole("gestionnaire");
  if (!process.env.SMTP_HOST) {
    return { ok: false, error: "SMTP non configuré (variable SMTP_HOST vide)." };
  }
  try {
    await sendMail({
      to: session.user.email,
      subject: "Test — CultuRésa",
      html: "<p>Ceci est un e-mail de test envoyé depuis l'interface d'administration de CultuRésa.</p>",
    });
  } catch {
    return { ok: false, error: "Échec de l'envoi (vérifiez la configuration SMTP)." };
  }
  return { ok: true };
}
