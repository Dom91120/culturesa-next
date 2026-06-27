"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { setConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { sendMail } from "@/server/mailer";
import { encryptSecret } from "@/server/secret-crypto";
import { sendTemplatedMail } from "@/server/services/mail-send";

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
  // Sinon on le stocke CHIFFRÉ (jamais en clair en base / dans les dumps).
  if (d.password !== "") entries["mail.password"] = encryptSecret(d.password);

  await setConfigMany(entries);
  revalidatePath("/configuration");
  return { ok: true };
}

export async function sendTestMailAction(to: string): Promise<ActionState> {
  await requireRole("administrateur");

  const parsed = z.string().trim().email().safeParse(to);
  if (!parsed.success) return { ok: false, error: "Adresse destinataire invalide." };

  try {
    await sendTemplatedMail({ to: parsed.data, kind: "email_test", mode: "direct" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Échec de l'envoi.";
    return { ok: false, error: msg };
  }
  return { ok: true };
}

// ─── File d'attente des e-mails en échec (renvoi best-effort) ────────────────

const mailIdSchema = z.coerce.number().int().positive();

/** Renvoie un e-mail en échec : succès → suppression de la file ; échec → MAJ erreur/essais. */
export async function retryFailedMailAction(id: number): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = mailIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Identifiant invalide." };
  const mail = await prisma.failedMail.findUnique({ where: { id: parsed.data } });
  if (!mail) return { ok: false, error: "E-mail introuvable." };
  try {
    await sendMail({
      to: mail.toAddr,
      subject: mail.subject,
      html: mail.html,
      text: mail.text || undefined,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Échec de l'envoi.";
    await prisma.failedMail.update({
      where: { id: mail.id },
      data: { attempts: { increment: 1 }, lastTriedAt: new Date(), error },
    });
    revalidatePath("/messagerie");
    return { ok: false, error };
  }
  await prisma.failedMail.delete({ where: { id: mail.id } });
  revalidatePath("/messagerie");
  return { ok: true };
}

/** Renvoie TOUS les e-mails en échec (les envoyés sont retirés ; les autres mis à jour). */
export async function retryAllFailedMailsAction(): Promise<
  ActionState & { sent?: number; failed?: number }
> {
  await requireRole("administrateur");
  const mails = await prisma.failedMail.findMany({ orderBy: { createdAt: "asc" } });
  let sent = 0;
  let failed = 0;
  for (const mail of mails) {
    try {
      await sendMail({
        to: mail.toAddr,
        subject: mail.subject,
        html: mail.html,
        text: mail.text || undefined,
      });
      await prisma.failedMail.delete({ where: { id: mail.id } });
      sent++;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Échec de l'envoi.";
      await prisma.failedMail.update({
        where: { id: mail.id },
        data: { attempts: { increment: 1 }, lastTriedAt: new Date(), error },
      });
      failed++;
    }
  }
  revalidatePath("/messagerie");
  return {
    ok: failed === 0,
    sent,
    failed,
    error: failed > 0 ? `${failed} e-mail(s) toujours en échec.` : undefined,
  };
}

/** Retire un e-mail de la file sans le renvoyer (abandon). */
export async function deleteFailedMailAction(id: number): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = mailIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Identifiant invalide." };
  await prisma.failedMail.delete({ where: { id: parsed.data } }).catch(() => {});
  revalidatePath("/messagerie");
  return { ok: true };
}
