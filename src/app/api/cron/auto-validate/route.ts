import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/server/cron";
import { runAutoValidation } from "@/server/services/auto-validate";
import {
  getCronSchedule,
  getLastCronAt,
  isScheduleDue,
  markCronAt,
  recordCronRun,
  summarizeAutoValidate,
} from "@/server/services/cron-tasks";
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
  if (!(await isAuthorizedCron())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [schedule, lastCronAt] = await Promise.all([
    getCronSchedule("auto-validate"),
    getLastCronAt("auto-validate"),
  ]);
  if (!isScheduleDue(schedule, lastCronAt)) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await markCronAt("auto-validate");

  try {
    const stats = await runAutoValidation();
    const digest = await sendManagerDigest();
    await recordCronRun("auto-validate", {
      ok: true,
      trigger: "cron",
      summary: summarizeAutoValidate(stats, digest),
    });
    return NextResponse.json({ ok: true, ...stats, managerDigest: digest });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun("auto-validate", { ok: false, trigger: "cron", summary: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
