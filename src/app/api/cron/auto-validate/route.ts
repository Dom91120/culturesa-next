import { runScheduledTask } from "@/server/cron-route";
import { runAutoValidation } from "@/server/services/auto-validate";
import { summarizeAutoValidate } from "@/server/services/cron-tasks";
import { sendManagerDigest } from "@/server/services/manager-notice";

/**
 * Auto-validation des réservations selon `service.autoValidationDelay` (délai signé
 * en minutes : négatif = minutes ouvrées, positif = minutes calendaires). Appelé
 * toutes les 5 min par le conteneur cron (cf. cron/crontab) ; ne s'exécute que si la
 * planification configurée (Tâches planifiées › CRON, défaut toutes les 15 min) est due.
 *
 * Enchaîne le digest de notification des gestionnaires (si l'échéance configurée
 * dans Administration > Configuration est atteinte).
 */
export async function GET() {
  return runScheduledTask("auto-validate", async () => {
    const stats = await runAutoValidation();
    const digest = await sendManagerDigest();
    return {
      summary: summarizeAutoValidate(stats, digest),
      payload: { ...stats, managerDigest: digest },
    };
  });
}
