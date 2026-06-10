import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { create } from "svg-captcha";

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

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET manquant : requis pour signer le captcha.");
  return s;
}

const normalize = (s: string) => s.trim().toUpperCase();

function sign(answer: string, exp: number, nonce: string): string {
  return createHmac("sha256", secret())
    .update(`${normalize(answer)}|${exp}|${nonce}`)
    .digest("base64url");
}

export function createCaptcha(): { svg: string; token: string } {
  const { text, data } = create({
    size: 6,
    charPreset: CHAR_PRESET,
    noise: 4,
    color: false,
    inverse: true, // glyphes clairs sur fond sombre (thème de l'app)
    background: "#0f1117",
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
  if (!Number.isFinite(exp) || Date.now() > exp) return false;

  const expected = sign(answer, exp, nonce);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // timingSafeEqual exige des buffers de même longueur.
  return a.length === b.length && timingSafeEqual(a, b);
}
