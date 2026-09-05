import { runScheduledTask } from "@/server/cron-route";
import { summarizeWaitingList } from "@/server/services/cron-tasks";
import { runWaitingList } from "@/server/services/waiting-list";

/**
 * Liste d'attente (cf. services/waiting-list) : pour chaque inscrit, dans l'ordre
 * d'inscription, cherche les créneaux réservables correspondant à ses disponibilités —
 * inscription automatique si demandée, sinon e-mail « créneaux libérés » (nouveautés
 * seulement). Appelé toutes les 5 min par le conteneur cron (cf. cron/crontab).
 */
export async function GET() {
  return runScheduledTask("waiting-list", async () => {
    const r = await runWaitingList();
    return { summary: summarizeWaitingList(r), payload: r };
  });
}
