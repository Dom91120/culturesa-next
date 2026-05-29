import { headers } from "next/headers";

/**
 * Vérifie le secret partagé envoyé par le conteneur cron.
 * Renvoie true si la requête est autorisée.
 */
export async function isAuthorizedCron() {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = (await headers()).get("x-cron-secret");
  return provided === secret;
}
