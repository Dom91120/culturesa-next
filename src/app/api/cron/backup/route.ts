import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { createAutoBackup } from "@/server/services/backup";
import {
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
  summarizeBackup,
} from "@/server/services/cron-tasks";

/**
 * Export automatique de la base : dump `culturesa-<ts>.sql.gz` + rotation sur les
 * 7 plus récents (cf. createAutoBackup). Appelé toutes les 5 min par le conteneur
 * cron (cf. cron/crontab) ; ne s'exécute que si la planification configurée
 * (Tâches planifiées › CRON, défaut 02h00) est due.
 */
export async function GET() {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [schedule, lastCronAt] = await Promise.all([
    getCronSchedule("backup"),
    getLastCronAt("backup"),
  ]);
  if (!isScheduleDue(schedule, lastCronAt)) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await markCronAt("backup");

  try {
    const result = await createAutoBackup();
    await recordCronRun("backup", {
      ok: true,
      trigger: "cron",
      summary: summarizeBackup(result),
    });
    return NextResponse.json({ ok: true, file: result.file.name, purged: result.purged });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun("backup", { ok: false, trigger: "cron", summary: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
