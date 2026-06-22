// Limiteur de débit en mémoire (fenêtre fixe). NON partagé entre instances : suffisant
// pour ce déploiement mono-conteneur, comme le rate-limit intégré de Better Auth (lui
// aussi en mémoire). Sert à brider les endpoints hors périmètre Better Auth qui déclenchent
// un travail coûteux ou un envoi d'e-mail (génération de captcha, demande de suppression
// de compte) et n'avaient aucune limite.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  if (buckets.size < 4096) return; // purge paresseuse
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * Renvoie `true` si l'action identifiée par `key` est AUTORISÉE (sous le quota `max` sur
 * la fenêtre `windowMs`), `false` si le quota est dépassé. Chaque appel autorisé compte.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}
