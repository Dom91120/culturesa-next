import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { runBookingReminders } from "@/server/services/booking-reminders";
import {
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
  summarizeBookingReminders,
} from "@/server/services/cron-tasks";

/**
 * Rappels de réservation : envoie aux usagers un e-mail une semaine avant (J-7) et
 * la veille (J-1) de chaque séance réservée et confirmée. Idempotent. Appelé toutes
 * les 5 min par le conteneur cron (cf. cron/crontab) ; ne s'exécute que si la
 * planification configurée (Tâches planifiées › CRON, défaut 07h00) est due.
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [schedule, lastCronAt] = await Promise.all([
    getCronSchedule("booking-reminder"),
    getLastCronAt("booking-reminder"),
  ]);
  if (!isScheduleDue(schedule, lastCronAt)) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await markCronAt("booking-reminder");

  try {
    const sent = await runBookingReminders();
    await recordCronRun("booking-reminder", {
      ok: true,
      trigger: "cron",
      summary: summarizeBookingReminders(sent),
    });
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun("booking-reminder", { ok: false, trigger: "cron", summary: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
