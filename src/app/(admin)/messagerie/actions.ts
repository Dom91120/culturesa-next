"use server";

import type { ActionState } from "@/lib/action-state";
import { setConfigMany } from "@/server/config";
import { requireRole } from "@/server/guards";
import { sendMail } from "@/server/mailer";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const mailConfigSchema = z.object({
  driver: z.enum(["smtp", "mail", "sendmail"]),
  from: z.string().trim().max(190),
  fromName: z.string().trim().max(190),
  host: z.string().trim().max(190),
  port: z.string().trim().max(5),
  security: z.enum(["", "tls", "ssl"]),
  username: z.string().trim().max(190),
  // Mot de passe : non trimé (peut contenir des espaces), vide = conserver l'actuel.
  password: z.string().max(190),
});

export type MailConfigInput = z.infer<typeof mailConfigSchema>;

export async function saveMailConfigAction(input: MailConfigInput): Promise<ActionState> {
  await requireRole("administrateur");

  const parsed = mailConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;

  // Validation métier : en mode SMTP, serveur + expéditeur obligatoires.
  if (d.driver === "smtp" && (!d.host || !d.from)) {
    return { ok: false, error: "Serveur SMTP et adresse expéditeur sont requis." };
  }
  if (d.from && !z.string().email().safeParse(d.from).success) {
    return { ok: false, error: "Adresse expéditeur invalide." };
  }

  const entries: Record<string, string> = {
    "mail.driver": d.driver,
    "mail.from": d.from,
    "mail.fromName": d.fromName,
    "mail.host": d.host,
    "mail.port": d.port,
    "mail.security": d.security,
    "mail.username": d.username,
  };
  // Mot de passe laissé vide => on conserve l'actuel (on n'écrit pas la clé).
  if (d.password !== "") entries["mail.password"] = d.password;

  await setConfigMany(entries);
  revalidatePath("/configuration");
  return { ok: true };
}

export async function sendTestMailAction(to: string): Promise<ActionState> {
  await requireRole("administrateur");

  const parsed = z.string().trim().email().safeParse(to);
  if (!parsed.success) return { ok: false, error: "Adresse destinataire invalide." };

  try {
    await sendMail({
      to: parsed.data,
      subject: "Test — CultuRésa",
      html: "<p>Ceci est un e-mail de test envoyé depuis l'interface d'administration de CultuRésa.</p>",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Échec de l'envoi.";
    return { ok: false, error: msg };
  }
  return { ok: true };
}
