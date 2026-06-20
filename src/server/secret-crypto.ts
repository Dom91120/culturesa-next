import crypto from "node:crypto";

// Chiffrement « au repos » des secrets stockés dans app_config (ex. mot de passe SMTP),
// pour qu'ils n'apparaissent pas en clair dans la base ni dans les dumps quotidiens.
// AES-256-GCM ; clé dérivée du secret applicatif (BETTER_AUTH_SECRET, déjà requis).
// Format stocké : "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>".

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  return crypto.createHash("sha256").update(secret).digest(); // 32 octets
}

/** Indique si une valeur stockée est déjà chiffrée par ce module. */
export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Chiffre un secret pour stockage. "" → "" (rien à chiffrer) ; déjà chiffré → inchangé. */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

/**
 * Déchiffre une valeur stockée. Une valeur NON préfixée est renvoyée telle quelle
 * (rétro-compatibilité : ancien secret en clair, ou repli variable d'environnement).
 * En cas d'échec (clé changée / donnée corrompue), renvoie "" sans lever.
 */
export function decryptSecret(stored: string): string {
  if (!stored || !isEncrypted(stored)) return stored ?? "";
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
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
