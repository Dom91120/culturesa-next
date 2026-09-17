import { promises as fs } from "node:fs";
import path from "node:path";
import { pad2 } from "@/lib/date-utc";
import { parisWallToInstant, toParisWall } from "@/lib/paris-time";
import { getConfigMany, setConfig } from "@/server/config";
import { prisma } from "@/server/db";

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

export type CronTaskKey =
  | "auto-validate"
  | "validation-notice"
  | "waiting-list"
  | "rgpd-retention"
  | "booking-reminder"
  | "backup";

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
    key: "validation-notice",
    label: "Notifications de validation",
    description:
      "Envoie les e-mails de validation / remise en attente des réservations après le délai de regroupement (Administration › Échanges) : seul l'état final est notifié, une hésitation du gestionnaire (validé, dévalidé…) ne produit qu'un e-mail au plus.",
    defaultSchedule: { type: "everyMinutes", step: 5 },
    runnable: true,
  },
  {
    key: "waiting-list",
    label: "Liste d'attente",
    description:
      "Pour chaque inscrit sur une liste d'attente (services où le réglage est actif), dans l'ordre d'inscription : cherche les créneaux réservables correspondant à ses disponibilités, l'inscrit automatiquement s'il l'a demandé, sinon le prévient par e-mail des nouveaux créneaux libérés. Un service dont l'agenda vient d'être modifié est reporté au passage suivant (délai de carence, ci-dessous).",
    defaultSchedule: { type: "everyMinutes", step: 5 },
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

function taskDef(key: CronTaskKey): CronTaskDef {
  // CRON_TASKS couvre toutes les clés du type : le repli ne sert qu'au typage.
  return CRON_TASKS.find((t) => t.key === key) ?? CRON_TASKS[0];
}

/** Valeur brute de `cron.schedule.<clé>` → planification valide, sinon le défaut de la tâche. */
function parseSchedule(raw: string, def: CronTaskDef): CronSchedule {
  if (!def.runnable || !raw) return def.defaultSchedule;
  try {
    const parsed = JSON.parse(raw);
    if (isValidSchedule(parsed)) return parsed;
  } catch {
    // valeur illisible → défaut
  }
  return def.defaultSchedule;
}

/** Planifications effectives (configurées, repli sur les défauts ; backup toujours par défaut). */
export async function getCronSchedules(): Promise<Record<CronTaskKey, CronSchedule>> {
  const editable = CRON_TASKS.filter((t) => t.runnable);
  const cfg = await getConfigMany(editable.map((t) => scheduleKey(t.key)));
  const out = {} as Record<CronTaskKey, CronSchedule>;
  for (const t of CRON_TASKS) out[t.key] = parseSchedule(cfg[scheduleKey(t.key)] ?? "", t);
  return out;
}

/** Planification d'UNE tâche (une seule clé lue — appelé à chaque passage des routes cron). */
export async function getCronSchedule(key: CronTaskKey): Promise<CronSchedule> {
  const cfg = await getConfigMany([scheduleKey(key)]);
  return parseSchedule(cfg[scheduleKey(key)] ?? "", taskDef(key));
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

/** Dernier déclenchement planifié d'UNE tâche (une seule clé lue). */
export async function getLastCronAt(key: CronTaskKey): Promise<Date | null> {
  const raw = (await getConfigMany([lastCronKey(key)]))[lastCronKey(key)];
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Marque le déclenchement planifié (posé AVANT l'exécution : une tentative par échéance). */
export async function markCronAt(key: CronTaskKey, now: Date = new Date()): Promise<void> {
  await setConfig(lastCronKey(key), now.toISOString());
}

// ── Verrou d'exécution ───────────────────────────────────────────────────────────────

/**
 * Identifiant numérique (int32 signé, FNV-1a) du verrou d'une tâche — déterministe,
 * calculé côté app pour rester lisible dans `pg_locks` (objid) et testable sans base.
 */
export function cronLockId(key: CronTaskKey): number {
  let h = 0x811c9dc5;
  for (const ch of `cron:${key}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Durée maximale d'une exécution sous verrou (l'export de base est la plus longue). */
export const CRON_LOCK_TIMEOUT_MS = 30 * 60_000;

export type CronLockOutcome<T> = { acquired: false } | { acquired: true; result: T };

/**
 * Exécute `fn` sous le VERROU de la tâche (audit 2026-09-17, A5) : `pg_try_advisory_xact_lock`
 * dans une transaction tenue le temps de l'exécution, donc relâché quoi qu'il arrive (fin,
 * erreur, coupure de connexion). Deux passages concurrents de la même tâche — deux appels
 * du conteneur cron qui se chevauchent, ou une exécution manuelle pendant un passage
 * planifié — ne se recouvrent plus : le second obtient `{ acquired: false }` sans rien
 * faire. Sans verrou, « due ? » puis « marquer » n'étaient pas atomiques et deux passages
 * pouvaient tourner ensemble (double e-mail, double inscription automatique).
 *
 * La transaction ne sert QU'AU verrou : `fn` travaille avec le client global (ses
 * écritures — horodatage, journal — sont validées au fil de l'eau, visibles du passage
 * suivant même si `fn` lève). `fn` doit donc ATTRAPER ses propres erreurs pour les
 * consigner ; une exception qui remonte relâche simplement le verrou.
 */
export async function withCronLock<T>(
  key: CronTaskKey,
  fn: () => Promise<T>,
): Promise<CronLockOutcome<T>> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${cronLockId(key)}::bigint) AS locked`;
      if (!rows[0]?.locked) return { acquired: false as const };
      return { acquired: true as const, result: await fn() };
    },
    { timeout: CRON_LOCK_TIMEOUT_MS, maxWait: 5_000 },
  );
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

export function summarizeValidationNotices(r: {
  due: number;
  sent: number;
  silent: number;
}): string {
  return `${r.sent} e-mail(s) envoyé(s), ${r.silent} sans changement, sur ${r.due} échéance(s)`;
}

export function summarizeWaitingList(r: {
  services: number;
  entries: number;
  notified: number;
  booked: number;
  expired: number;
  onHold?: number;
}): string {
  const hold = r.onHold
    ? `, ${r.onHold} service(s) reporté(s) (agenda en cours de modification)`
    : "";
  return `${r.entries} inscrit(s) sur ${r.services} service(s) : ${r.booked} inscription(s) automatique(s), ${r.notified} e-mail(s) « créneaux libérés », ${r.expired} inscription(s) échue(s)${hold}`;
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
