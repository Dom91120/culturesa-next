import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { messageClient } from "@/server/errors";
import {
  type CronTaskKey,
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
  withCronLock,
} from "@/server/services/cron-tasks";

/**
 * Protocole COMMUN des routes /api/cron/* (source unique — 4 scaffolds identiques
 * avant l'audit 2026-07-24) : garde par secret partagé, VERROU d'exécution de la tâche,
 * planification due (Tâches planifiées › CRON), horodatage, exécution, journal des
 * exécutions. `run` renvoie le résumé pour le journal et le corps de la réponse ; toute
 * exception est journalisée en échec et renvoyée en 500.
 *
 * Verrou (A5, 2026-09-17) : « due ? » → « marquer » → exécuter se déroule sous
 * `withCronLock` ; un second appel pendant l'exécution répond `skipped: true, running:
 * true` sans rien faire, et un appel juste après relit l'horodatage posé → non due.
 *
 * NB : vit hors de cron-tasks.ts (importé par le panneau admin CLIENT) car il
 * dépend de next/server.
 */
type Outcome =
  | { kind: "notDue" }
  | { kind: "ok"; payload?: Record<string, unknown> }
  | { kind: "failed"; error: unknown };

export async function runScheduledTask(
  key: CronTaskKey,
  run: () => Promise<{ summary: string; payload?: Record<string, unknown> }>,
): Promise<NextResponse> {
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const locked = await withCronLock<Outcome>(key, async () => {
    const [schedule, lastCronAt] = await Promise.all([getCronSchedule(key), getLastCronAt(key)]);
    if (!isScheduleDue(schedule, lastCronAt)) return { kind: "notDue" };
    await markCronAt(key);
    try {
      const { summary, payload } = await run();
      await recordCronRun(key, { ok: true, trigger: "cron", summary });
      return { kind: "ok", payload };
    } catch (e) {
      // Deux destinataires, deux niveaux de détail (constat D7).
      //
      // Le JOURNAL des exécutions est consulté par un administrateur dans l'écran
      // Tâches planifiées : c'est là que le détail sert, et il ne quitte pas le
      // serveur. On y garde donc le message complet — le tronquer rendrait une tâche
      // en échec indiagnosticable.
      const detail = e instanceof Error ? e.message : "Erreur inconnue.";
      await recordCronRun(key, { ok: false, trigger: "cron", summary: detail });
      return { kind: "failed", error: e };
    }
  });

  // Une autre exécution de la même tâche est en cours : on ne la double pas.
  if (!locked.acquired) return NextResponse.json({ ok: true, skipped: true, running: true });
  const outcome = locked.result;
  if (outcome.kind === "notDue") return NextResponse.json({ ok: true, skipped: true });
  if (outcome.kind === "ok") return NextResponse.json({ ok: true, ...outcome.payload });

  // La RÉPONSE HTTP, elle, part sur le réseau — vers le conteneur cron, mais
  // aussi vers quiconque détiendrait `CRON_SECRET` (cf. BAC5). Elle ne porte
  // qu'un libellé générique et la référence permettant de retrouver la trace.
  return NextResponse.json(
    {
      ok: false,
      error: await messageClient(outcome.error, `Échec de la tâche « ${key} ».`, `cron:${key}`),
    },
    { status: 500 },
  );
}
