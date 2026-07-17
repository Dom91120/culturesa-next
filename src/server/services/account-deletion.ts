import { emailButton } from "@/lib/email-theme";
import { greeting } from "@/lib/mail-render";
import { getAppUrl } from "@/server/config";
import { hmacSign, timingSafeEqualStr } from "@/server/crypto";
import { prisma } from "@/server/db";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { anonymizeUser, assertNotLastActiveAdmin, RgpdError } from "@/server/services/rgpd";

// ════════════════════════════════════════════════════════════
//  Suppression de compte en self-service (RGPD art. 17).
//
//  Flux : l'usager demande la suppression depuis « Mon compte » → on lui envoie un
//  e-mail avec un lien signé valable 24 h → en cliquant, le compte est anonymisé
//  (`anonymizeUser(..., "self_service")`). Le token signé (HMAC) fait foi : la page
//  de confirmation n'a pas besoin de session active.
// ════════════════════════════════════════════════════════════

const TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// Signature du lien sous une clé dédiée à la suppression (séparation de domaine,
// server/crypto). L'e-mail COURANT du compte fait partie du payload signé : après
// anonymisation (qui remplace l'e-mail), un token déjà consommé ne se vérifie plus →
// usage unique de fait, sans table de nonces (audit 2026-07-17). Un changement
// d'adresse invalide de même un lien envoyé à l'ancienne adresse.
function sign(userId: string, exp: number, email: string): string {
  return hmacSign("account-deletion", `${userId}|${exp}|${email}`);
}

/** Token signé `${b64(userId)}.${exp}.${sig}` valable TTL_MS. */
function makeToken(userId: string, email: string): string {
  const exp = Date.now() + TTL_MS;
  return `${Buffer.from(userId).toString("base64url")}.${exp}.${sign(userId, exp, email)}`;
}

/** Décode la STRUCTURE d'un token (non expiré) ; la signature est vérifiée par
 * l'appelant contre l'e-mail courant du compte (cf. sign). */
function parseToken(
  token: string | null | undefined,
): { userId: string; exp: number; sig: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [u, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  try {
    return { userId: Buffer.from(u, "base64url").toString("utf8"), exp, sig };
  } catch {
    return null;
  }
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

  const base = await getAppUrl();
  const url = `${base}/auth/supprimer-compte?token=${encodeURIComponent(makeToken(userId, email))}`;
  const prenom = user.prenom?.trim() ?? "";
  const vars = { salutation: greeting(prenom), prenom, url };

  await sendTemplatedMail({
    to: email,
    kind: "account_deletion_request",
    vars,
    rawVars: { bouton: emailButton(url, "Confirmer la suppression") },
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
  const parsed = parseToken(token);
  if (!parsed) return { ok: false, reason: "invalid" };
  // Vérification contre l'e-mail COURANT : un compte déjà anonymisé (e-mail remplacé)
  // ou une adresse changée depuis l'envoi → signature caduque (usage unique).
  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { email: true },
  });
  if (!user || !timingSafeEqualStr(parsed.sig, sign(parsed.userId, parsed.exp, user.email ?? ""))) {
    return { ok: false, reason: "invalid" };
  }
  try {
    await anonymizeUser(parsed.userId, "self_service");
  } catch (e) {
    if (e instanceof RgpdError) return { ok: false, reason: "last_admin" };
    throw e;
  }
  return { ok: true };
}
