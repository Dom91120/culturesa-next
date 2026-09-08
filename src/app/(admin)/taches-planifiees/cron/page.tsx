import { requireRole } from "@/server/guards";
import { listBackups } from "@/server/services/backup";
import {
  CRON_TASKS,
  getCronRuns,
  getCronSchedules,
  getLastCronAts,
  nextCronRun,
  readCrontabFile,
  scheduleLabel,
} from "@/server/services/cron-tasks";
import { CronPanel, type CronTaskRow } from "./cron-panel";

export const dynamic = "force-dynamic";

export default async function CronPage() {
  // Administration réservée aux administrateurs.
  await requireRole("administrateur");
  const [runs, schedules, lastCronAts, crontab, backups] = await Promise.all([
    getCronRuns(),
    getCronSchedules(),
    getLastCronAts(),
    readCrontabFile(),
    listBackups(),
  ]);

  // La sauvegarde tourne dans le conteneur cron sans passer par l'app : sa dernière
  // exécution est déduite du dump automatique le plus récent (liste triée par date).
  const lastAuto = backups.find((f) => f.kind === "auto");
  const now = new Date();

  const rows: CronTaskRow[] = CRON_TASKS.map((t) => {
    let last = runs[t.key] ?? null;
    if (!last && t.key === "backup" && lastAuto) {
      last = {
        at: lastAuto.mtime.toISOString(),
        ok: true,
        trigger: "cron",
        summary: lastAuto.name,
      };
    }
    const schedule = schedules[t.key];
    return {
      key: t.key,
      label: t.label,
      description: t.description,
      schedule,
      scheduleLabel: scheduleLabel(schedule),
      runnable: t.runnable,
      nextRun: nextCronRun(schedule, lastCronAts[t.key] ?? null, now).toISOString(),
      lastRun: last,
    };
  });

  // Dernier passage du conteneur cron = déclenchement planifié le plus récent, toutes
  // tâches confondues (posé à chaque échéance atteinte, cf. markCronAt).
  const lastCronPass = Object.values(lastCronAts)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <CronPanel
      rows={rows}
      cronSecretConfigured={Boolean(process.env.CRON_SECRET)}
      crontab={crontab}
      lastCronPass={lastCronPass ? lastCronPass.toISOString() : null}
      generatedAt={now.toISOString()}
    />
  );
}
