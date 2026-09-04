import { runScheduledTask } from "@/server/cron-route";
import { summarizeValidationNotices } from "@/server/services/cron-tasks";
import { runValidationNotices } from "@/server/services/validation-notice";

/**
 * Notifications DIFFÉRÉES de (dé)validation manuelle (cf. services/validation-notice) :
 * envoie, pour chaque fenêtre arrivée à échéance, l'e-mail reflétant l'état FINAL de la
 * réservation — ou rien si le gestionnaire est revenu à l'état que l'usager connaît.
 * Appelé toutes les 5 min par le conteneur cron (cf. cron/crontab).
 */
export async function GET() {
  return runScheduledTask("validation-notice", async () => {
    const r = await runValidationNotices();
    return { summary: summarizeValidationNotices(r), payload: r };
  });
}
