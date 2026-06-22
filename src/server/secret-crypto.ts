import crypto from "node:crypto";
import { deriveKey } from "@/server/crypto";

// Chiffrement « au repos » des secrets stockés dans app_config (ex. mot de passe SMTP),
// pour qu'ils n'apparaissent pas en clair dans la base ni dans les dumps quotidiens.
// AES-256-GCM. Format stocké : "enc:<v>:<iv b64>:<tag b64>:<ciphertext b64>".
//   - v2 (actuel) : clé dérivée par HKDF (séparation de domaine, cf. server/crypto).
//   - v1 (legacy)  : clé = SHA-256(BETTER_AUTH_SECRET). Déchiffrement conservé pour ne pas
//                    perdre les secrets déjà chiffrés ; tout nouveau chiffrement passe en v2.

const PREFIX_V2 = "enc:v2:";
const PREFIX_V1 = "enc:v1:";

// Clé v2 : dérivée par HKDF, isolée pour cet usage (chiffrement des secrets app_config).
const keyV2 = (): Buffer => deriveKey("secret-crypto:aes-256-gcm");
// Clé v1 : ancienne dérivation par simple SHA-256 (déchiffrement rétro-compatible).
const keyV1 = (): Buffer =>
  crypto
    .createHash("sha256")
    .update(process.env.BETTER_AUTH_SECRET ?? "")
    .digest();

/** Indique si une valeur stockée est déjà chiffrée par ce module (v1 ou v2). */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && (value.startsWith(PREFIX_V2) || value.startsWith(PREFIX_V1));
}

/** Chiffre un secret pour stockage. "" → "" (rien à chiffrer) ; déjà chiffré → inchangé. */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyV2(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX_V2 + [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

/**
 * Déchiffre une valeur stockée. Une valeur NON préfixée est renvoyée telle quelle
 * (rétro-compatibilité : ancien secret en clair, ou repli variable d'environnement).
 * En cas d'échec (clé changée / donnée corrompue), renvoie "" sans lever.
 */
export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored ?? "";
  const v2 = stored.startsWith(PREFIX_V2);
  const prefix = v2 ? PREFIX_V2 : PREFIX_V1;
  const k = v2 ? keyV2() : keyV1();
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(prefix.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    console.warn("[secret-crypto] déchiffrement impossible (BETTER_AUTH_SECRET changé ?).");
    return "";
  }
}
