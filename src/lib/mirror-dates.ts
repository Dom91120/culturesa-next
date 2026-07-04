import { slotWeekTag } from "@/lib/iso-week";
import type { DAYS } from "@/schemas/config";

export type DayKey = (typeof DAYS)[number];

/** Jour ISO (1 = lundi … 7 = dimanche) → clé de jour. Interne (usage local uniquement). */
const ISO_DOW_KEY: Record<number, DayKey> = {
  1: "lun",
  2: "mar",
  3: "mer",
  4: "jeu",
  5: "ven",
  6: "sam",
  7: "dim",
};

/**
 * Dates des miroirs d'un créneau récurrent MONO-JOUR sur [startDate, endDate] (bornes UTC,
 * format « YYYY-MM-DD »). Une date est retenue si :
 *   - son jour de semaine vaut `slotDay` (et `slotDay` fait partie des `activeDays` du
 *     service — sinon aucun miroir) ;
 *   - elle n'est pas un jour férié (sauf `openOnHolidays`) ;
 *   - sa parité A/B (convention UNIQUE lib/iso-week : semaine ISO impaire = A) est dans
 *     `allowedWeeks` (["A","B"] = toutes ; ["A"] ou ["B"] = parité unique).
 *
 * Source UNIQUE de matérialisation des occurrences : utilisée par la bascule d'exercice
 * (exercice.ts) ET la sauvegarde/ajout de créneau (slots.ts). Toute correction de la
 * logique fériés/parité se fait ici, une seule fois.
 */
export function mirrorDates(args: {
  startDate: string;
  endDate: string;
  slotDay: DayKey;
  activeDays: DayKey[];
  allowedWeeks: string[];
  holidaySet: Set<string>;
  openOnHolidays: boolean;
}): string[] {
  const { startDate, endDate, slotDay, activeDays, allowedWeeks, holidaySet, openOnHolidays } =
    args;
  if (!activeDays.includes(slotDay)) return [];
  const out: string[] = [];
  let cur = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    const dateStr = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay() || 7; // 1=lun..7=dim
    cur = new Date(cur.getTime() + 86_400_000);
    if (ISO_DOW_KEY[dow] !== slotDay) continue;
    if (!openOnHolidays && holidaySet.has(dateStr)) continue;
    if (!allowedWeeks.includes(slotWeekTag(dateStr))) continue;
    out.push(dateStr);
  }
  return out;
}
