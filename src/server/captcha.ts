import { randomBytes } from "node:crypto";
import { create } from "svg-captcha";
import { hmacSign, timingSafeEqualStr } from "@/server/crypto";

/**
 * CAPTCHA image auto-hébergé (port de l'ancien captcha_img.php du legacy), sans
 * service tiers ni clés. svg-captcha rend les caractères en `<path>` vectoriels
 * (la réponse n'apparaît donc pas en clair dans le markup), et le défi est lié à
 * sa vérification par un **token HMAC sans état** : aucune session ni table en BDD.
 *
 *   token = `${exp}.${nonce}.${HMAC_SHA256(secret, "REPONSE|exp|nonce")}`
 *
 * Le client renvoie ce token + la saisie utilisateur ; le serveur recalcule la
 * signature à partir de la saisie et la compare en temps constant. Un token est
 * valable `TTL_MS` puis expire.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes
// Jeu de caractères non ambigu (ni 0/O, ni 1/I/L) — comme le legacy.
const CHAR_PRESET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const normalize = (s: string) => s.trim().toUpperCase();

// Signature du défi sous une clé dédiée au captcha (séparation de domaine, cf. server/crypto).
function sign(answer: string, exp: number, nonce: string): string {
  return hmacSign("captcha", `${normalize(answer)}|${exp}|${nonce}`);
}

// Anti-rejeu : un défi résolu ne doit être accepté qu'UNE fois. On mémorise les nonces
// déjà consommés (nonce → expiration) en mémoire — suffisant pour ce déploiement mono-
// instance, à l'image du rate-limit Better Auth (lui aussi en mémoire). Sans cela, un
// même couple {token, réponse} restait valide pendant tout le TTL → création de comptes
// en boucle avec un seul captcha résolu.
const consumed = new Map<string, number>();
function pruneConsumed(now: number): void {
  if (consumed.size < 1024) return; // purge paresseuse pour éviter une croissance illimitée
  for (const [n, exp] of consumed) if (exp <= now) consumed.delete(n);
}

export function createCaptcha(): { svg: string; token: string } {
  const { text, data } = create({
    size: 6,
    charPreset: CHAR_PRESET,
    noise: 4,
    color: false,
    inverse: true, // glyphes clairs sur fond sombre
    background: "#252933", // gris très sombre (sans virer au noir)
    width: 230,
    height: 72,
    fontSize: 56,
  });
  const exp = Date.now() + TTL_MS;
  const nonce = randomBytes(9).toString("base64url");
  return { svg: data, token: `${exp}.${nonce}.${sign(text, exp, nonce)}` };
}

export function verifyCaptcha(
  token: string | null | undefined,
  answer: string | null | undefined,
): boolean {
  if (!token || !answer) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  const now = Date.now();
  if (!Number.isFinite(exp) || now > exp) return false;

  if (!timingSafeEqualStr(sig, sign(answer, exp, nonce))) return false;

  // Signature valide : on consomme le nonce. S'il a déjà servi, on refuse (anti-rejeu).
  if (consumed.has(nonce)) return false;
  consumed.set(nonce, exp);
  pruneConsumed(now);
  return true;
}
