import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

/**
 * Vérifie le secret partagé envoyé par le conteneur cron.
 * Renvoie true si la requête est autorisée.
 * Comparaison à temps constant (cohérent avec captcha.ts / account-deletion.ts).
 */
export async function isAuthorizedCron() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (await headers()).get("x-cron-secret");
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
