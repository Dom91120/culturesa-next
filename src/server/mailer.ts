import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { decryptSecret } from "@/server/secret-crypto";

// Logo embarqué en pièce jointe inline (CID) dans chaque e-mail — déposé sous
// public/email-logo.png. Lu une seule fois et mis en cache (null si absent).
let logoCache: Buffer | null | undefined;
function getLogoBuffer(): Buffer | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const p = join(process.cwd(), "public", "email-logo.png");
    logoCache = existsSync(p) ? readFileSync(p) : null;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

// Transport SMTP (Nodemailer) — remplace PHPMailer.
//
// La configuration est désormais lue depuis la base (table app_config, clés
// `mail.*`), avec repli sur les variables d'environnement (SMTP_HOST, etc.)
// lorsqu'une clé est absente/vide. La parité avec l'ancienne app PHP est ainsi
// assurée : tout est éditable depuis l'écran « Configuration ».

const MAIL_KEYS = [
  "mail.driver",
  "mail.from",
  "mail.fromName",
  "mail.host",
  "mail.port",
  "mail.security",
  "mail.username",
  "mail.password",
] as const;

export type MailSettings = {
  driver: string;
  from: string;
  fromName: string;
  host: string;
  port: number;
  security: string; // "" | "tls" | "ssl"
  username: string;
  password: string;
};

/** Repli : valeur base si non vide, sinon variable d'env, sinon "". */
function pick(dbValue: string, envValue: string | undefined): string {
  return dbValue.trim() !== "" ? dbValue : (envValue ?? "");
}

/**
 * Construit les réglages mail effectifs : config base complétée par l'env.
 * Lue à chaque envoi (volume faible, pas de cache nécessaire ici).
 */
export async function getMailSettings(): Promise<MailSettings> {
  const cfg = await getConfigMany([...MAIL_KEYS]);
  const portStr = pick(cfg["mail.port"], process.env.SMTP_PORT);
  const port = Number(portStr) || 587;
  return {
    driver: cfg["mail.driver"].trim() || "smtp",
    from: pick(cfg["mail.from"], process.env.SMTP_FROM),
    fromName: cfg["mail.fromName"].trim(),
    host: pick(cfg["mail.host"], process.env.SMTP_HOST),
    port,
    security: cfg["mail.security"].trim(),
    username: pick(cfg["mail.username"], process.env.SMTP_USER),
    password: pick(decryptSecret(cfg["mail.password"]), process.env.SMTP_PASSWORD),
  };
}

/** Adresse d'expéditeur formatée : `"Nom" <adresse>` ou simplement `<adresse>`. */
function formatFrom(s: MailSettings): string {
  const fallback = "CultuRésa <no-reply@example.com>";
  if (!s.from) return fallback;
  return s.fromName ? `${s.fromName} <${s.from}>` : s.from;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
  const s = await getMailSettings();

  // En Node, seul SMTP est réellement pris en charge par nodemailer ici.
  // Les modes "mail"/"sendmail" de l'ancien PHP n'ont pas d'équivalent natif :
  // on route quand même via SMTP si un hôte est configuré, sinon erreur claire.
  if (!s.host) {
    throw new Error(
      "Transport e-mail non configuré : renseignez le serveur SMTP (mail.host) ou la variable SMTP_HOST.",
    );
  }

  const secure = s.security === "ssl" || s.port === 465;
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure,
    // STARTTLS : port non sécurisé + requireTLS quand security === "tls".
    ...(s.security === "tls" ? { requireTLS: true } : {}),
    auth: s.username ? { user: s.username, pass: s.password } : undefined,
  });

  const logo = getLogoBuffer();
  const attachments = logo
    ? [{ filename: "logo.png", content: logo, cid: "culturesa-logo" }]
    : undefined;
  return transport.sendMail({ from: formatFrom(s), attachments, ...opts });
}

/**
 * Envoie un e-mail en mode « best-effort » : en cas d'échec, l'e-mail est enregistré
 * dans la file `failed_mails` pour pouvoir être renvoyé depuis Administration >
 * Messagerie. Ne lève jamais — renvoie l'état d'envoi à l'appelant.
 */
export async function sendMailOrQueue(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  try {
    await sendMail(opts);
    return { ok: true, queued: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try {
      await prisma.failedMail.create({
        data: {
          toAddr: opts.to,
          subject: opts.subject,
          html: opts.html,
          text: opts.text ?? "",
          error,
        },
      });
      return { ok: false, queued: true, error };
    } catch (e2) {
      console.error("[sendMailOrQueue] impossible d'enregistrer l'e-mail en échec:", e2);
      return { ok: false, queued: false, error };
    }
  }
}
