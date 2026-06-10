import { createHmac, timingSafeEqual } from "node:crypto";
import { emailButton, wrapEmailHtml } from "@/lib/email-theme";
import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import {
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";
import { RgpdError, anonymizeUser, assertNotLastActiveAdmin } from "@/server/services/rgpd";

// ════════════════════════════════════════════════════════════
//  Suppression de compte en self-service (RGPD art. 17).
//
//  Flux : l'usager demande la suppression depuis « Mon compte » → on lui envoie un
//  e-mail avec un lien signé valable 24 h → en cliquant, le compte est anonymisé
//  (`anonymizeUser(..., "self_service")`). Le token signé (HMAC) fait foi : la page
//  de confirmation n'a pas besoin de session active.
// ════════════════════════════════════════════════════════════

const TTL_MS = 24 * 60 * 60 * 1000; // 24 h

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s)
    throw new Error("BETTER_AUTH_SECRET manquant : requis pour signer le lien de suppression.");
  return s;
}

function sign(userId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${userId}|${exp}`).digest("base64url");
}

/** Token signé `${b64(userId)}.${exp}.${sig}` valable TTL_MS. */
function makeToken(userId: string): string {
  const exp = Date.now() + TTL_MS;
  return `${Buffer.from(userId).toString("base64url")}.${exp}.${sign(userId, exp)}`;
}

/** Décode et vérifie un token ; renvoie l'userId si valide et non expiré, sinon null. */
function readToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [u, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  let userId: string;
  try {
    userId = Buffer.from(u, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sign(userId, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}

function appUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    ""
  ).replace(/\/$/, "");
}

/**
 * Envoie à l'usager l'e-mail de confirmation de suppression (lien 24 h). Best-effort.
 * No-op silencieux si le compte est introuvable / déjà anonymisé / sans e-mail.
 */
export async function requestAccountDeletion(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, prenom: true, anonymizedAt: true },
  });
  const email = user?.email?.trim();
  if (!user || user.anonymizedAt || !email?.includes("@")) return;

  // Le dernier administrateur actif ne peut pas demander sa propre suppression.
  await assertNotLastActiveAdmin(prisma, userId);

  const url = `${appUrl()}/auth/supprimer-compte?token=${encodeURIComponent(makeToken(userId))}`;
  const prenom = user.prenom?.trim() ?? "";
  const vars = { salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,", prenom, url };

  const tpl = await getMailTemplate("account_deletion_request");
  const inner = renderHtmlTemplate(tpl.html, vars, {
    bouton: emailButton(url, "Confirmer la suppression"),
  });
  const subject = renderSubjectTemplate(tpl.subject, vars);
  await sendMailOrQueue({
    to: email,
    subject,
    html: wrapEmailHtml(inner, { preheader: subject, appUrl: await getAppUrl() }),
    text: htmlToText(inner),
  });
}

export type ConfirmDeletionResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "last_admin" };

/**
 * Confirme la suppression à partir du token signé : anonymise le compte encodé
 * (idempotent). Renvoie `invalid` si le token est absent/falsifié/expiré.
 */
export async function confirmAccountDeletion(
  token: string | null | undefined,
): Promise<ConfirmDeletionResult> {
  const userId = readToken(token);
  if (!userId) return { ok: false, reason: "invalid" };
  // anonymizeUser est idempotent : si déjà anonymisé, c'est un no-op → on confirme.
  try {
    await anonymizeUser(userId, "self_service");
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, reason: "last_admin" };
    throw e;
  }
  return { ok: true };
}
