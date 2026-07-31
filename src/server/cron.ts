import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

/**
 * Autorisation des routes `/api/cron/*` (constat BAC5).
 *
 * ── Portée réelle d'une fuite de `CRON_SECRET`, mesurée ──
 * Moindre que ce que le constat laissait entendre. `runScheduledTask` refuse toute
 * exécution hors échéance (`isScheduleDue`) : un appel répété répond `skipped` sans
 * rien faire. Et `runRgpdRetention` n'anonymise que les comptes DÉJÀ notifiés et
 * hors délai de grâce — jamais un compte arbitraire. Le pouvoir conféré par le
 * secret se limite donc à faire courir une tâche un peu plus tôt dans sa fenêtre,
 * non à déclencher une anonymisation de masse.
 *
 * ── Pourquoi la restriction d'origine N'EST PAS faite ici ──
 * Le constat recommandait de réserver ces routes au réseau interne. La voie évidente
 * — repérer les en-têtes `X-Forwarded-*`, qu'un reverse proxy ajoute et que le
 * conteneur `cron` ne pose pas — NE FONCTIONNE PAS : **Next.js les définit lui-même
 * sur chaque requête** lorsqu'ils sont absents (`next/dist/server/base-server.js`,
 * `req.headers['x-forwarded-for'] ??= …`). Ils sont donc toujours présents, quelle
 * que soit l'origine. Éprouvé : l'appel interne légitime était refusé au même titre
 * qu'un appel externe — livré tel quel, ce contrôle aurait arrêté TOUTES les tâches
 * planifiées, en silence, sans autre trace qu'un 401 dans un journal que personne ne
 * lit tant que les tâches semblent tourner.
 *
 * L'adresse source ne discrimine pas davantage : le conteneur `cron` et le reverse
 * proxy de l'hôte présentent tous deux une adresse privée.
 *
 * La restriction appartient donc au **proxy**, seul à savoir ce qui vient de
 * l'extérieur : il lui suffit de ne pas exposer `/api/cron/`. La règle est écrite
 * dans `DEPLOY.md` et rattachée à la demande adressée à l'administrateur réseau
 * (cf. constat A5, même sujet : une part de la politique de sécurité vit hors du
 * dépôt). Mieux vaut un contrôle absent et documenté qu'un contrôle en trompe-l'œil.
 */
export function autoriseCron(h: Headers, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  // Pas de secret configuré → aucune route ouverte. L'absence de configuration ne
  // doit pas se traduire par une absence de contrôle.
  if (!secret) return false;

  const provided = h.get("x-cron-secret");
  if (!provided) return false;
  // Comparaison à temps constant (cohérent avec captcha.ts / account-deletion.ts).
  // Le contrôle de longueur préalable évite que `timingSafeEqual` ne lève sur une
  // simple tentative erronée — ce qui transformerait un refus en erreur 500.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vérifie le secret partagé envoyé par le conteneur cron. */
export async function isAuthorizedCron(): Promise<boolean> {
  return autoriseCron(await headers());
}
