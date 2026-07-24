import { runScheduledTask } from "@/server/cron-route";
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
    return {
      summary: summarizeRgpdRetention({ notified, anonymized }),
      payload: { notified, anonymized },
    };
  });
}
