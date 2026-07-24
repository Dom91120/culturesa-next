import { runScheduledTask } from "@/server/cron-route";
import { runBookingReminders } from "@/server/services/booking-reminders";
import { summarizeBookingReminders } from "@/server/services/cron-tasks";

/**
 * Rappels de réservation : envoie aux usagers un e-mail une semaine avant (J-7) et
 * la veille (J-1) de chaque séance réservée et confirmée. Idempotent. Appelé toutes
 * les 5 min par le conteneur cron (cf. cron/crontab) ; ne s'exécute que si la
 * planification configurée (Tâches planifiées › CRON, défaut 07h00) est due.
 */
export async function GET() {
  return runScheduledTask("booking-reminder", async () => {
    const sent = await runBookingReminders();
    return { summary: summarizeBookingReminders(sent), payload: { sent } };
  });
}
