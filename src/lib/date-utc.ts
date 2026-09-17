// ─── Dates « calendaires » en UTC — SOURCE UNIQUE ────────────────────────────────
// Pour les valeurs @db.Date (slots.slotDate, periods.dateStart/dateEnd, exercices…)
// que Prisma remonte à MINUIT UTC : « YYYY-MM-DD » ↔ Date, décalage de jours, lundi
// de la semaine. Toutes les fonctions raisonnent en UTC (getUTC*/Date.UTC) — le
// fuseau du serveur n'intervient jamais.
//
// NE PAS CONFONDRE avec lib/agenda-core (grilles, HEURE LOCALE du navigateur) ni avec
// lib/paris-time / lib/booking-delay (« aujourd'hui » = date murale Europe/Paris).
// Une date murale Paris s'obtient d'abord en chaîne (todayParisISO), PUIS se manipule
// ici en UTC : c'est le contrat des dates ISO de l'app (audit 2026-09-17, D6 — huit
// copies locales de ces helpers avant la factorisation).

/** Entier → 2 chiffres (« 07 »). */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Entier → 4 chiffres (« 0999 », années < 1000 comprises). */
export const pad4 = (n: number): string => String(n).padStart(4, "0");

/** Date (valeur @db.Date à minuit UTC) → « YYYY-MM-DD ». */
export const ymdUtc = (d: Date): string => d.toISOString().slice(0, 10);

/** « YYYY-MM-DD » → Date à MINUIT UTC (comparable aux valeurs @db.Date). */
export const parseYmdUtc = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

/** Nouvelle Date décalée de `n` jours (UTC ; l'entrée n'est pas modifiée). */
export function addDaysUtc(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Lundi (minuit UTC) de la semaine ISO contenant `d` (lundi → lui-même). */
export function mondayOfUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = lundi … 6 = dimanche
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
