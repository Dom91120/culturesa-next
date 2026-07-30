import { prisma } from "@/server/db";

/**
 * Limitation de débit (fenêtre fixe) pour les points d'entrée HORS périmètre Better
 * Auth qui déclenchent un travail coûteux ou un envoi d'e-mail : génération de
 * captcha, demande de suppression de compte.
 *
 * ── Pourquoi la base plutôt qu'une Map (constat A3) ──
 * Les compteurs vivaient en mémoire de processus. Un `docker compose restart` — ou
 * un simple déploiement — les remettait tous à zéro : il suffisait d'attendre une
 * mise à jour pour repartir avec un quota neuf. Deux réplicas auraient en outre eu
 * chacun le sien, divisant silencieusement le quota effectif par deux. A1 avait déjà
 * traité les deux compteurs qui protègent l'authentification ; ceux-ci en restaient.
 *
 * ── Pourquoi une seule requête SQL ──
 * Lire puis écrire laisserait deux requêtes simultanées lire le même compteur et
 * franchir ensemble la limite. `INSERT … ON CONFLICT DO UPDATE` fait l'incrément et
 * la remise à zéro de la fenêtre en une opération atomique, sans transaction ni
 * verrou explicite. Le `RETURNING` rapporte le compteur d'APRÈS incrément : le seuil
 * se lit donc `<= max`, et non `< max`.
 *
 * ── L'horloge est celle de la BASE ──
 * `now()` côté PostgreSQL, jamais `Date.now()` côté application : avec plusieurs
 * conteneurs, deux horloges désynchronisées rouvriraient les fenêtres à des instants
 * différents. Une seule référence de temps, celle qui détient les compteurs.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const fenetre = `${Math.max(1, Math.round(windowMs))} milliseconds`;
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO throttle_buckets ("key", "count", "reset_at")
      VALUES (${key}, 1, now() + ${fenetre}::interval)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN throttle_buckets."reset_at" <= now() THEN 1
          ELSE throttle_buckets."count" + 1
        END,
        "reset_at" = CASE
          WHEN throttle_buckets."reset_at" <= now() THEN now() + ${fenetre}::interval
          ELSE throttle_buckets."reset_at"
        END
      RETURNING "count"
    `;
    return (rows[0]?.count ?? 1) <= max;
  } catch (e) {
    // ÉCHEC FERMÉ. Un limiteur qui laisse passer quand il ne peut plus compter n'est
    // plus un limiteur : une base indisponible deviendrait le moyen de le désactiver.
    // Le refus est ici sans coût réel — les deux appelants (génération de captcha,
    // demande de suppression de compte) ont de toute façon besoin de la base pour
    // aboutir. Refuser ne prive donc d'aucun service qui aurait pu fonctionner.
    console.error("[rate-limit] comptage impossible, requête refusée:", e);
    return false;
  }
}

/** Purge des seaux périmés (tâche de rétention). */
export async function purgeStaleThrottleBuckets(): Promise<number> {
  const { count } = await prisma.throttleBucket.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return count;
}
