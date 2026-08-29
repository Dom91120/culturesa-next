/**
 * Plage d'un créneau RÉCURRENT à l'intérieur de sa période.
 *
 * Un créneau récurrent tourne par défaut sur toute sa période. Ses bornes propres
 * (`slots.dateStart` / `dateEnd`, nulles par défaut) permettent de le restreindre —
 * une activité qui démarre après la Toussaint, un cycle qui s'arrête avant Noël.
 *
 * ── La règle, en un seul endroit ──
 * La PÉRIODE reste la borne extérieure : les dates du créneau sont rognées sur elle.
 * Et si le recouvrement devient VIDE — la période a été déplacée ailleurs sous le
 * créneau —, on oublie les bornes du créneau et on retombe sur la période entière.
 *
 * Ce repli n'est pas une commodité : sans lui, le créneau ne s'afficherait plus sur
 * AUCUNE semaine (les grilles n'affichent que des semaines réelles), donc ne serait
 * plus ni modifiable ni supprimable depuis l'agenda. Un créneau fantôme est un plus
 * mauvais résultat qu'un créneau qui redevient large — celui-ci se voit et se corrige,
 * l'autre ne se voit pas.
 *
 * Corollaire pour l'interface : afficher les dates EFFECTIVES (ce que renvoie cette
 * fonction), et non les seules valeurs saisies — l'administrateur qui rouvre un
 * créneau après avoir déplacé la période doit constater qu'il couvre à nouveau tout.
 */
export type DateRange = { start: string; end: string };

export function resolveSlotRange(args: {
  /** Bornes de la période, en « YYYY-MM-DD ». */
  periodStart: string;
  periodEnd: string;
  /** Bornes propres du créneau ; nulles/vides = toute la période. */
  slotStart?: string | null;
  slotEnd?: string | null;
}): DateRange {
  const { periodStart, periodEnd, slotStart, slotEnd } = args;
  const start = slotStart && slotStart > periodStart ? slotStart : periodStart;
  const end = slotEnd && slotEnd < periodEnd ? slotEnd : periodEnd;
  // Recouvrement vide (bornes croisées, ou période déplacée hors du créneau) : repli
  // sur la période entière.
  if (start > end) return { start: periodStart, end: periodEnd };
  return { start, end };
}

/**
 * La date tombe-t-elle dans la plage effective du créneau ? Utilisé par les grilles
 * pour n'afficher un créneau restreint que sur les semaines où il tourne réellement.
 * Une période sans dates ne restreint rien (état légitime en cours de saisie).
 */
export function slotRunsOn(args: {
  dateYmd: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  slotStart?: string | null;
  slotEnd?: string | null;
}): boolean {
  const { dateYmd, periodStart, periodEnd, slotStart, slotEnd } = args;
  if (!periodStart || !periodEnd) return true;
  const { start, end } = resolveSlotRange({ periodStart, periodEnd, slotStart, slotEnd });
  return dateYmd >= start && dateYmd <= end;
}
