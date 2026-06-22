import crypto from "node:crypto";

// Primitives cryptographiques partagées, dérivées du secret applicatif (BETTER_AUTH_SECRET).
// Séparation de domaine : chaque usage (chiffrement des secrets, HMAC du captcha, HMAC du
// lien de suppression) obtient une clé DISTINCTE via HKDF, au lieu de partager la graine
// brute. Évite aussi la réimplémentation du sign/verify HMAC à plusieurs endroits.

function rootSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) {
    throw new Error("BETTER_AUTH_SECRET manquant : requis pour la dérivation cryptographique.");
  }
  return s;
}

/**
 * Clé de 32 octets dérivée du secret applicatif par HKDF-SHA256, isolée par `info`.
 * Sans sel : le secret est censé être à haute entropie (≠ mot de passe humain) ; c'est
 * `info` qui assure la séparation entre domaines d'usage.
 */
export function deriveKey(info: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", rootSecret(), Buffer.alloc(0), info, 32));
}

/** HMAC-SHA256 (base64url) d'un message, sous une clé propre au domaine `info`. */
export function hmacSign(info: string, message: string): string {
  return crypto.createHmac("sha256", deriveKey(info)).update(message).digest("base64url");
}

/** Comparaison en temps constant de deux chaînes (longueurs différentes → false). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
