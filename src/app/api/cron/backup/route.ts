import { runScheduledTask } from "@/server/cron-route";
import { createAutoBackup } from "@/server/services/backup";
import { summarizeBackup } from "@/server/services/cron-tasks";

/**
 * Export automatique de la base : dump `culturesa-<ts>.sql.gz` + rotation sur les
 * 7 plus récents (cf. createAutoBackup). Appelé toutes les 5 min par le conteneur
 * cron (cf. cron/crontab) ; ne s'exécute que si la planification configurée
 * (Tâches planifiées › CRON, défaut 02h00) est due.
 */
export async function GET() {
  return runScheduledTask("backup", async () => {
    const result = await createAutoBackup();
    return {
      summary: summarizeBackup(result),
      payload: { file: result.file.name, purged: result.purged },
    };
  });
}
