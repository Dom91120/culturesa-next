// =====================================================================================
// Éditions de la LISTE D'ATTENTE (fonctions pures, testées) — Dom 2026-09-07 :
//   • « Demande par demi-journée » : combien d'inscrits sont disponibles chaque
//     demi-journée (et combien ont demandé la réservation automatique) → où ouvrir un
//     créneau ferait le plus d'heureux ;
//   • demande par période souhaitée ;
//   • délai (jours) entre deux dates ISO, pour l'historique et les placements.
// =====================================================================================

import { DAY_NAMES } from "@/lib/agenda-core";
import { dispoKey, type HalfDay, parseDispos } from "@/lib/waiting-list";

const DAY_ORDER = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

export type DemandEntry = {
  dispos: string; // CSV de demi-journées
  periodIds: number[]; // [] = toutes
  autoInscription: boolean;
};

export type HalfDayDemand = { total: number; auto: number };

export type DayDemand = {
  day: string; // clé « lun »…
  label: string; // « Lundi »
  am: HalfDayDemand;
  pm: HalfDayDemand;
};

/**
 * Demande par demi-journée : une ligne par jour (ordre de la semaine), pour les jours
 * d'ouverture du service (`openDays`) ET tout jour déclaré par au moins un inscrit.
 * Chaque inscrit compte UNE fois par demi-journée déclarée.
 */
export function demandByHalfDay(
  entries: readonly DemandEntry[],
  openDays: readonly string[],
): DayDemand[] {
  const parsed = entries.map((e) => ({ set: parseDispos(e.dispos), auto: e.autoInscription }));
  const days = new Set<string>(openDays);
  for (const p of parsed) for (const k of p.set) days.add(k.split("-")[0]);
  const count = (day: string, half: HalfDay): HalfDayDemand => {
    const key = dispoKey(day, half);
    let total = 0;
    let auto = 0;
    for (const p of parsed) {
      if (!p.set.has(key)) continue;
      total++;
      if (p.auto) auto++;
    }
    return { total, auto };
  };
  return DAY_ORDER.filter((d) => days.has(d)).map((day) => ({
    day,
    label: DAY_NAMES[day] ?? day,
    am: count(day, "am"),
    pm: count(day, "pm"),
  }));
}

export type PeriodDemand = { id: number; label: string; total: number; auto: number };

/**
 * Demande par période souhaitée (périodes de l'exercice visible, dans l'ordre donné) :
 * un inscrit sans restriction compte sur TOUTES les périodes.
 */
export function demandByPeriod(
  entries: readonly DemandEntry[],
  periods: readonly { id: number; label: string }[],
): PeriodDemand[] {
  return periods.map((p) => {
    let total = 0;
    let auto = 0;
    for (const e of entries) {
      if (e.periodIds.length > 0 && !e.periodIds.includes(p.id)) continue;
      total++;
      if (e.autoInscription) auto++;
    }
    return { id: p.id, label: p.label, total, auto };
  });
}

/** Nombre de jours (entier, ≥ 0) entre deux instants ISO. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}
