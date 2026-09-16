import { coveringForYmd, ISO_DAY_KEYS } from "@/lib/agenda-core";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";

/**
 * Fermeture d'une DATE au sens de l'agenda (jours hachurés, cf. makeDayClosure) : jour
 * inactif de l'exercice couvrant, férié quand l'exercice ferme les fériés, vacances
 * scolaires quand il ferme les vacances.
 *
 * Sert aux STATISTIQUES (Dom 2026-09-16) : les miroirs d'un récurrent existent en base
 * sur ces dates (ils sont matérialisés sur toute la période), mais l'agenda les hachure
 * et personne ne peut y réserver — ils ne sont pas une offre. Sans ce filtre, chaque
 * semaine de vacances pesait comme autant de séances vides dans le remplissage moyen
 * (84 % au lieu de 100 % sur un trimestre à deux semaines de vacances).
 *
 * Une date couverte par AUCUN exercice n'est PAS déclarée fermée ici : on ne retire de
 * l'offre que ce qu'un réglage d'exercice ferme explicitement (prudence sur l'historique
 * antérieur aux exercices).
 */
export type OfferExercice = {
  dateStart: string; // YYYY-MM-DD ("" = borne absente)
  dateEnd: string;
  activeDays: string; // CSV « lun,mar,… »
  openOnHolidays: boolean;
  openOnSchoolHolidays: boolean;
};

export function isOfferDateClosed(
  ymd: string,
  exercices: OfferExercice[],
  schoolHolidays: { dateStart: string; dateEnd: string }[],
): boolean {
  const exo = coveringForYmd(exercices, ymd);
  if (!exo) return false;
  const dayKey = ISO_DAY_KEYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
  const active = exo.activeDays
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (active.length > 0 && !active.includes(dayKey)) return true;
  if (!exo.openOnHolidays && isFrenchHoliday(ymd)) return true;
  return !exo.openOnSchoolHolidays && isInSchoolHolidayRange(ymd, schoolHolidays);
}
