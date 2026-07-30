import { runScheduledTask } from "@/server/cron-route";
import { purgeStaleLoginAttempts } from "@/server/login-throttle";
import { summarizeRgpdRetention } from "@/server/services/cron-tasks";
import { runRgpdRetention } from "@/server/services/rgpd";

/**
 * Rétention RGPD : préavis aux comptes inactifs (dernière activité ancienne),
 * puis anonymisation passé le délai de grâce sans reconnexion. Appelé toutes les
 * 5 min par le conteneur cron (cf. cron/crontab) ; ne s'exécute que si la
 * planification configurée (Tâches planifiées › CRON, défaut 03h00) est due.
 */
export async function GET() {
  return runScheduledTask("rgpd-retention", async () => {
    const { notified, anonymized } = await runRgpdRetention();
    // Purge des compteurs de tentatives de connexion périmés (constat A1) :
    // rattachée ici car c'est la même logique — ne pas conserver de données
    // au-delà de leur utilité. La table ne porte que des empreintes, mais elle
    // n'a pas vocation à croître indéfiniment. Best-effort : son échec ne doit
    // pas faire échouer la rétention RGPD, qui est la tâche importante.
    let purgedLoginAttempts = 0;
    try {
      purgedLoginAttempts = await purgeStaleLoginAttempts();
    } catch (e) {
      console.error("[cron] purge des compteurs de connexion échouée:", e);
    }
    return {
      summary: summarizeRgpdRetention({ notified, anonymized }),
      payload: { notified, anonymized, purgedLoginAttempts },
    };
  });
}
