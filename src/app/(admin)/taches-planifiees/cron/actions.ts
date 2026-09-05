"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/guards";
import { runAutoValidation } from "@/server/services/auto-validate";
import { createAutoBackup } from "@/server/services/backup";
import { runBookingReminders } from "@/server/services/booking-reminders";
import {
  CRON_TASKS,
  type CronSchedule,
  type CronTaskKey,
  isValidSchedule,
  recordCronRun,
  setCronSchedule,
  summarizeAutoValidate,
  summarizeBackup,
  summarizeBookingReminders,
  summarizeRgpdRetention,
  summarizeValidationNotices,
  summarizeWaitingList,
} from "@/server/services/cron-tasks";
import { sendManagerDigest } from "@/server/services/manager-notice";
import { runRgpdRetention } from "@/server/services/rgpd";
import { runValidationNotices } from "@/server/services/validation-notice";
import { runWaitingList } from "@/server/services/waiting-list";

export type RunCronResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Exécute une tâche planifiée À LA DEMANDE depuis l'admin (mêmes traitements que les
 * routes /api/cron/*, tous idempotents) et consigne le résultat (trigger « manuel »).
 */
export async function runCronTaskAction(key: CronTaskKey): Promise<RunCronResult> {
  await requireRole("administrateur");

  let run: () => Promise<string>;
  switch (key) {
    case "auto-validate":
      run = async () => {
        const stats = await runAutoValidation();
        const digest = await sendManagerDigest();
        return summarizeAutoValidate(stats, digest);
      };
      break;
    case "validation-notice":
      run = async () => summarizeValidationNotices(await runValidationNotices());
      break;
    case "waiting-list":
      run = async () => summarizeWaitingList(await runWaitingList());
      break;
    case "rgpd-retention":
      run = async () => summarizeRgpdRetention(await runRgpdRetention());
      break;
    case "booking-reminder":
      run = async () => summarizeBookingReminders(await runBookingReminders());
      break;
    case "backup":
      run = async () => summarizeBackup(await createAutoBackup());
      break;
    default:
      // Clé inconnue envoyée par le client.
      return { ok: false, error: "Cette tâche n'est pas exécutable depuis l'administration." };
  }

  try {
    const summary = await run();
    await recordCronRun(key, { ok: true, trigger: "manuel", summary });
    revalidatePath("/taches-planifiees/cron");
    return { ok: true, summary };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue.";
    await recordCronRun(key, { ok: false, trigger: "manuel", summary: message });
    revalidatePath("/taches-planifiees/cron");
    return { ok: false, error: message };
  }
}

/**
 * Modifie la planification d'une tâche applicative. Appliquée par les routes
 * /api/cron/* au prochain passage du conteneur cron (grille de 5 minutes).
 */
export async function updateCronScheduleAction(
  key: CronTaskKey,
  schedule: CronSchedule,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("administrateur");
  const def = CRON_TASKS.find((t) => t.key === key);
  if (!def?.runnable) {
    return { ok: false, error: "La planification de cette tâche n'est pas modifiable." };
  }
  if (!isValidSchedule(schedule)) {
    return { ok: false, error: "Planification invalide." };
  }
  await setCronSchedule(key, schedule);
  revalidatePath("/taches-planifiees/cron");
  return { ok: true };
}
