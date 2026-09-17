"use server";

import { revalidatePath } from "next/cache";
import { MAX_WAITLIST_QUIET_MINUTES } from "@/lib/waiting-list-quiet";
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
  withCronLock,
} from "@/server/services/cron-tasks";
import { sendManagerDigest } from "@/server/services/manager-notice";
import { runRgpdRetention } from "@/server/services/rgpd";
import { runValidationNotices } from "@/server/services/validation-notice";
import { runWaitingList } from "@/server/services/waiting-list";
import { setWaitlistQuietMinutes } from "@/server/services/waiting-list-quiet";

export type RunCronResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Exécute une tâche planifiée À LA DEMANDE depuis l'admin (mêmes traitements que les
 * routes /api/cron/*, tous idempotents) et consigne le résultat (trigger « manuel »).
 * L'exécution manuelle ignore la planification (c'est son but) mais passe par le MÊME
 * verrou que les routes cron : elle ne tourne jamais en parallèle d'un passage planifié
 * (ni d'un autre clic), et inversement.
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

  const locked = await withCronLock<RunCronResult>(key, async () => {
    try {
      const summary = await run();
      await recordCronRun(key, { ok: true, trigger: "manuel", summary });
      return { ok: true, summary };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue.";
      await recordCronRun(key, { ok: false, trigger: "manuel", summary: message });
      return { ok: false, error: message };
    }
  });
  if (!locked.acquired) {
    return {
      ok: false,
      error:
        "Cette tâche est déjà en cours d'exécution (passage planifié ou autre lancement) : réessayez dans quelques instants.",
    };
  }
  revalidatePath("/taches-planifiees/cron");
  return locked.result;
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

/**
 * Délai de carence de l'attribution automatique (liste d'attente) : minutes de calme
 * exigées sur l'agenda d'un service avant que la tâche ne l'apparie (0 = aucun délai).
 */
export async function setWaitlistQuietMinutesAction(
  minutes: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRole("administrateur");
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_WAITLIST_QUIET_MINUTES) {
    return { ok: false, error: `Délai invalide (0 à ${MAX_WAITLIST_QUIET_MINUTES} minutes).` };
  }
  await setWaitlistQuietMinutes(minutes);
  revalidatePath("/taches-planifiees/cron");
  return { ok: true };
}
