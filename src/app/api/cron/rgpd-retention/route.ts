import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import {
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
  summarizeRgpdRetention,
} from "@/server/services/cron-tasks";
import { runRgpdRetention } from "@/server/services/rgpd";

/**
 * Rétention RGPD : préavis aux comptes inactifs (dernière activité ancienne),
 * puis anonymisation passé le délai de grâce sans reconnexion. Appelé toutes les
 * 5 min par le conteneur cron (cf. cron/crontab) ; ne s'exécute que si la
 * planification configurée (Tâches planifiées › CRON, défaut 03h00) est due.
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [schedule, lastCronAt] = await Promise.all([
    getCronSchedule("rgpd-retention"),
    getLastCronAt("rgpd-retention"),
  ]);
  if (!isScheduleDue(schedule, lastCronAt)) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await markCronAt("rgpd-retention");

  try {
    const { notified, anonymized } = await runRgpdRetention();
    await recordCronRun("rgpd-retention", {
      ok: true,
      trigger: "cron",
      summary: summarizeRgpdRetention({ notified, anonymized }),
    });
    return NextResponse.json({ ok: true, notified, anonymized });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun("rgpd-retention", { ok: false, trigger: "cron", summary: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
