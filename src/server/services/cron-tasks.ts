import { promises as fs } from "node:fs";
import path from "node:path";
import { parisWallToInstant, toParisWall } from "@/lib/paris-time";
import { getConfigMany, setConfig } from "@/server/config";

/**
 * Tâches planifiées (onglet Administration › Tâches planifiées › CRON).
 *
 * Le conteneur cron de production (cron/crontab, busybox crond) APPELLE les routes
 * /api/cron/* toutes les 5 minutes : c'est CHAQUE ROUTE qui applique la planification
 * configurée ici (app_config `cron.schedule.<clé>`, modifiable dans l'admin, défauts
 * ci-dessous) et ne s'exécute que si son échéance est atteinte (cf. isScheduleDue).
 * L'export de la base suit le même mécanisme (route /api/cron/backup → pg_dump côté
 * app, cf. createAutoBackup) depuis l'abandon de backup.sh.
 *
 * Le module consigne aussi la dernière exécution de chaque tâche (`cron.lastRun.<clé>`,
 * alimentée par les routes et les exécutions manuelles) et le dernier déclenchement
 * planifié (`cron.lastCronAt.<clé>`, base du calcul d'échéance).
 */

export type CronTaskKey = "auto-validate" | "rgpd-retention" | "booking-reminder" | "backup";

export type CronSchedule =
  | { type: "everyMinutes"; step: number }
  | { type: "dailyAt"; hour: number; minute: number };

type CronTaskDef = {
  key: CronTaskKey;
  label: string;
  description: string;
  defaultSchedule: CronSchedule;
  /** Exécutable et replanifiable depuis l'admin (false = géré par le conteneur cron seul). */
  runnable: boolean;
};

export const CRON_TASKS: CronTaskDef[] = [
  {
    key: "auto-validate",
    label: "Auto-validation des réservations",
    description:
      "Valide les réservations en attente selon le délai configuré par service, puis envoie le digest de notification aux gestionnaires (échéance configurée en Administration › Configuration).",
    defaultSchedule: { type: "everyMinutes", step: 15 },
    runnable: true,
  },
  {
    key: "rgpd-retention",
    label: "Rétention RGPD",
    description:
      "Préavis aux comptes inactifs (dernière activité au-delà de la durée de conservation), puis anonymisation passé le délai de grâce sans reconnexion.",
    defaultSchedule: { type: "dailyAt", hour: 3, minute: 0 },
    runnable: true,
  },
  {
    key: "booking-reminder",
    label: "Rappels de réservation",
    description:
      "E-mails de rappel aux usagers une semaine avant (J-7) et la veille (J-1) de chaque séance réservée et confirmée.",
    defaultSchedule: { type: "dailyAt", hour: 7, minute: 0 },
    runnable: true,
  },
  {
    key: "backup",
    label: "Export de la base",
    description:
      "Dump PostgreSQL complet et compressé ; rotation : seuls les 7 exports automatiques les plus récents sont conservés. Purge également les exports manuels et téléversés de plus de 90 jours. Les exports sont gérés dans le sous-onglet Exports.",
    defaultSchedule: { type: "dailyAt", hour: 2, minute: 0 },
    runnable: true,
  },
];

/** Planification valide (clé de config potentiellement éditée à la main → re-validée). */
export function isValidSchedule(s: unknown): s is CronSchedule {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (o.type === "everyMinutes")
    return typeof o.step === "number" && Number.isInteger(o.step) && o.step >= 5 && o.step <= 1440;
  if (o.type === "dailyAt")
    return (
      typeof o.hour === "number" &&
      Number.isInteger(o.hour) &&
      o.hour >= 0 &&
      o.hour <= 23 &&
      typeof o.minute === "number" &&
      Number.isInteger(o.minute) &&
      o.minute >= 0 &&
      o.minute <= 59
    );
  return false;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Libellé lisible d'une planification. */
export function scheduleLabel(s: CronSchedule): string {
  if (s.type === "everyMinutes") {
    if (s.step % 60 === 0)
      return s.step === 60 ? "Toutes les heures" : `Toutes les ${s.step / 60} heures`;
    return `Toutes les ${s.step} minutes`;
  }
  return `Tous les jours à ${pad2(s.hour)}h${pad2(s.minute)}`;
}

const scheduleKey = (key: CronTaskKey) => `cron.schedule.${key}`;

/** Planifications effectives (configurées, repli sur les défauts ; backup toujours par défaut). */
export async function getCronSchedules(): Promise<Record<CronTaskKey, CronSchedule>> {
  const editable = CRON_TASKS.filter((t) => t.runnable);
  const cfg = await getConfigMany(editable.map((t) => scheduleKey(t.key)));
  const out = {} as Record<CronTaskKey, CronSchedule>;
  for (const t of CRON_TASKS) {
    out[t.key] = t.defaultSchedule;
    if (!t.runnable) continue;
    const raw = cfg[scheduleKey(t.key)];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (isValidSchedule(parsed)) out[t.key] = parsed;
    } catch {
      // valeur illisible → défaut
    }
  }
  return out;
}

export async function getCronSchedule(key: CronTaskKey): Promise<CronSchedule> {
  return (await getCronSchedules())[key];
}

export async function setCronSchedule(key: CronTaskKey, schedule: CronSchedule): Promise<void> {
  await setConfig(scheduleKey(key), JSON.stringify(schedule));
}

// ── Déclenchements planifiés (base du calcul d'échéance) ─────────────────────────────

const lastCronKey = (key: CronTaskKey) => `cron.lastCronAt.${key}`;

/** Derniers déclenchements PLANIFIÉS (les exécutions manuelles ne comptent pas). */
export async function getLastCronAts(): Promise<Partial<Record<CronTaskKey, Date>>> {
  const keys = CRON_TASKS.map((t) => t.key);
  const cfg = await getConfigMany(keys.map(lastCronKey));
  const out: Partial<Record<CronTaskKey, Date>> = {};
  for (const key of keys) {
    const raw = cfg[lastCronKey(key)];
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) out[key] = d;
  }
  return out;
}

export async function getLastCronAt(key: CronTaskKey): Promise<Date | null> {
  return (await getLastCronAts())[key] ?? null;
}

/** Marque le déclenchement planifié (posé AVANT l'exécution : une tentative par échéance). */
export async function markCronAt(key: CronTaskKey, now: Date = new Date()): Promise<void> {
  await setConfig(lastCronKey(key), now.toISOString());
}

/**
 * La tâche est-elle due ? Appelé par les routes /api/cron/* à chaque passage du
 * conteneur (toutes les 5 min) — heure murale Europe/Paris pour les heures fixes.
 */
export function isScheduleDue(
  schedule: CronSchedule,
  lastCronAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (schedule.type === "everyMinutes") {
    if (!lastCronAt) return true;
    // Tolérance de 2 min : absorbe le jitter des appels du crontab (grille de 5 min).
    return now.getTime() - lastCronAt.getTime() >= (schedule.step - 2) * 60000;
  }
  const w = toParisWall(now);
  const target = parisWallToInstant(w.y, w.mo, w.da, schedule.hour * 60 + schedule.minute);
  if (now.getTime() < target.getTime()) return false;
  // Due si pas encore déclenchée depuis l'échéance du jour (rattrapage tardif inclus).
  return !lastCronAt || lastCronAt.getTime() < target.getTime();
}

/** Prochaine échéance estimée (affichage admin). */
export function nextCronRun(
  schedule: CronSchedule,
  lastCronAt: Date | null,
  now: Date = new Date(),
): Date {
  if (schedule.type === "everyMinutes") {
    const next = lastCronAt ? lastCronAt.getTime() + schedule.step * 60000 : now.getTime();
    return new Date(Math.max(next, now.getTime()));
  }
  const w = toParisWall(now);
  const targetMin = schedule.hour * 60 + schedule.minute;
  const today = parisWallToInstant(w.y, w.mo, w.da, targetMin);
  if (today.getTime() > now.getTime()) return today;
  return parisWallToInstant(w.y, w.mo, w.da + 1, targetMin);
}

// ── Journal des exécutions ───────────────────────────────────────────────────────────

/** Dernière exécution consignée d'une tâche. */
type CronRunInfo = {
  at: string; // ISO
  ok: boolean;
  trigger: "cron" | "manuel";
  summary: string;
};

const runKey = (key: CronTaskKey) => `cron.lastRun.${key}`;

/** Consigne l'exécution d'une tâche (appelé par les routes /api/cron/* et l'admin). */
export async function recordCronRun(
  key: CronTaskKey,
  info: Omit<CronRunInfo, "at">,
): Promise<void> {
  await setConfig(runKey(key), JSON.stringify({ at: new Date().toISOString(), ...info }));
}

/** Dernières exécutions consignées, par tâche (absente = jamais exécutée/consignée). */
export async function getCronRuns(): Promise<Partial<Record<CronTaskKey, CronRunInfo>>> {
  const keys = CRON_TASKS.map((t) => t.key);
  const cfg = await getConfigMany(keys.map(runKey));
  const out: Partial<Record<CronTaskKey, CronRunInfo>> = {};
  for (const key of keys) {
    const raw = cfg[runKey(key)];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as CronRunInfo;
      if (parsed && typeof parsed.at === "string") out[key] = parsed;
    } catch {
      // valeur illisible (édition manuelle de app_config) → ignorée
    }
  }
  return out;
}

/** Résumés lisibles des exécutions (partagés entre routes cron et actions admin). */
export function summarizeAutoValidate(
  stats: { candidates: number; validated: number },
  digest: { emails: number },
): string {
  return `${stats.validated}/${stats.candidates} réservation(s) validée(s), ${digest.emails} notification(s) gestionnaire`;
}

export function summarizeRgpdRetention(r: { notified: number; anonymized: number }): string {
  return `${r.notified} préavis envoyé(s), ${r.anonymized} compte(s) anonymisé(s)`;
}

export function summarizeBookingReminders(r: { week: number; day: number }): string {
  return `${r.week} rappel(s) J-7, ${r.day} rappel(s) J-1`;
}

export function summarizeBackup(r: {
  file: { name: string };
  purged: number;
  purgedAged: number;
}): string {
  // Les deux purges sont annoncées SÉPARÉMENT : la rotation est un régime permanent
  // et attendu ; la purge par âge supprime des fichiers déposés à la main, dont on
  // se souvient. Les additionner rendrait la seconde invisible dans le bruit.
  const parts = [r.file.name];
  if (r.purged > 0) parts.push(`${r.purged} export(s) auto purgé(s) par rotation`);
  if (r.purgedAged > 0)
    parts.push(`${r.purgedAged} export(s) manuel(s)/téléversé(s) de plus de 90 j purgé(s)`);
  return parts.join(", ");
}

/**
 * Contenu brut de cron/crontab, si le fichier est présent (poste de dev). Dans l'image
 * Docker de l'app le dossier cron/ n'est pas embarqué (il ne sert qu'au conteneur cron)
 * → null, l'admin affiche alors les descripteurs ci-dessus.
 */
export async function readCrontabFile(): Promise<string | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), "cron", "crontab"), "utf8");
  } catch {
    return null;
  }
}
