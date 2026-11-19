import { gaugeUnits } from "@/lib/gauge";

// ════════════════════════════════════════════════════════════════════════════
//  « N places restantes » — agenda de la Direction des accueils de loisirs
//  (Dom 2026-11-19).
//
//  Ce rôle ne reçoit que les réservations des accueils de loisirs : le compteur
//  habituel (« 1/12 ») y serait FAUX, puisqu'il ignorerait les réservations masquées.
//  Le serveur lui transmet donc, par créneau daté, le TOTAL occupé par les autres
//  catégories — deux nombres, aucune identité, aucun détail par réservation — et la
//  grille en déduit les places restantes.
//
//  Module pur (ni Prisma ni React) : partagé par la page serveur et la grille.
// ════════════════════════════════════════════════════════════════════════════

/** Occupation masquée d'une cellule : `n` réservations, `u` unités de jauge. */
export type HiddenOccupancy = { n: number; u: number };

/**
 * Clé d'une cellule de l'agenda en semaine réelle : créneau AFFICHÉ (le récurrent
 * parent pour une occurrence, le ponctuel lui-même sinon) + date du jour.
 */
export function occupancyKey(cellSlotId: string, ymd: string): string {
  return `${cellSlotId}|${ymd}`;
}

/**
 * Regroupe les totaux par créneau daté en totaux par CELLULE. Une occurrence de
 * récurrent (slot miroir) se rattache à la cellule de son créneau parent, comme dans
 * le moteur de la grille (`buildBlocksByDay`). Les créneaux inconnus ou sans date
 * sont ignorés : ils ne correspondent à aucune cellule affichable.
 */
export function buildHiddenOccupancy(
  rows: { slotId: string; count: number; enfants: number; accompagnants: number }[],
  datedSlots: { id: string; slotDate: string | null; parentSlotId: string | null }[],
  gaugeAccompagnants: boolean,
): Record<string, HiddenOccupancy> {
  const byId = new Map(datedSlots.map((s) => [s.id, s]));
  const out: Record<string, HiddenOccupancy> = {};
  for (const r of rows) {
    const slot = byId.get(r.slotId);
    if (!slot?.slotDate) continue;
    const key = occupancyKey(slot.parentSlotId ?? slot.id, slot.slotDate);
    const cur = out[key] ?? { n: 0, u: 0 };
    cur.n += r.count;
    cur.u += gaugeUnits(r.enfants, r.accompagnants, gaugeAccompagnants);
    out[key] = cur;
  }
  return out;
}

/**
 * Places restantes d'une cellule, MÊME règle que le compteur des gestionnaires :
 * créneau à jauge → unités (enfants, plus accompagnants selon le service) ; sinon une
 * place par réservation. `visibleUsed` est le `used` du bloc (déjà compté selon la
 * jauge), `visibleCount` son nombre de réservations. Jamais négatif.
 */
export function remainingPlaces(args: {
  capacity: number;
  jauge: boolean;
  visibleUsed: number;
  visibleCount: number;
  hidden: HiddenOccupancy | undefined;
}): number {
  const taken = args.jauge
    ? args.visibleUsed + (args.hidden?.u ?? 0)
    : args.visibleCount + (args.hidden?.n ?? 0);
  return Math.max(0, args.capacity - taken);
}

/**
 * Libellé du restant, dans l'UNITÉ du créneau (Dom 2026-11-19) — sans quoi « 10 places »
 * se lirait « 10 enfants » sur un créneau qui compte en réalité des réservations :
 *   - créneau à jauge  → des PLACES (une par enfant) : « 7 places restantes » ;
 *   - créneau sans jauge → des GROUPES (une réservation entière) : « 7 groupes possibles ».
 * « Complet » à zéro, dans les deux cas.
 */
export function remainingLabel(remaining: number, jauge: boolean): string {
  if (remaining <= 0) return "Complet";
  if (jauge) return remaining === 1 ? "1 place restante" : `${remaining} places restantes`;
  return remaining === 1 ? "1 groupe possible" : `${remaining} groupes possibles`;
}
