import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import {
  type CronTaskKey,
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
} from "@/server/services/cron-tasks";

/**
 * Protocole COMMUN des routes /api/cron/* (source unique — 4 scaffolds identiques
 * avant l'audit 2026-07-24) : garde par secret partagé, planification due
 * (Tâches planifiées › CRON), horodatage, exécution, journal des exécutions.
 * `run` renvoie le résumé pour le journal et le corps de la réponse ; toute
 * exception est journalisée en échec et renvoyée en 500.
 *
 * NB : vit hors de cron-tasks.ts (importé par le panneau admin CLIENT) car il
 * dépend de next/server.
 */
export async function runScheduledTask(
  key: CronTaskKey,
  run: () => Promise<{ summary: string; payload?: Record<string, unknown> }>,
): Promise<NextResponse> {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [schedule, lastCronAt] = await Promise.all([getCronSchedule(key), getLastCronAt(key)]);
  if (!isScheduleDue(schedule, lastCronAt)) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await markCronAt(key);

  try {
    const { summary, payload } = await run();
    await recordCronRun(key, { ok: true, trigger: "cron", summary });
    return NextResponse.json({ ok: true, ...payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun(key, { ok: false, trigger: "cron", summary: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
