// =====================================================================================
// Statistiques des CRÉNEAUX d'un service (fonctions pures, testées). Les Statistiques
// comptent des SÉANCES (occurrences datées réservées) ; ici on regarde l'OFFRE : les
// créneaux datés proposés (miroirs des récurrents + ponctuels), réservés ou non.
// Les deux nombres divergent dès qu'un créneau reste libre (offre > séances) ou qu'un
// créneau à jauge accueille plusieurs réservations (séances > créneaux) — c'est dans ce
// cas que l'écran affiche ce volet (demande Dom 2026-09-12).
// =====================================================================================

export type SlotStatRow = {
  id: string;
  date: string; // YYYY-MM-DD
  // Miroir d'un récurrent (non null) ou ponctuel autonome (null) — filtre de type.
  parentSlotId: string | null;
};

export type SlotStats = {
  // Créneaux datés proposés sur la plage (filtre de type appliqué au créneau).
  creneaux: number;
  // Créneaux portant au moins une séance (quel que soit le type de la réservation).
  creneauxReserves: number;
  creneauxLibres: number;
  // Créneaux libres déjà passés (date < aujourd'hui) : de l'offre perdue, plus réservable.
  creneauxLibresPasses: number;
  // creneauxReserves / creneaux (%), null sans créneau.
  tauxOccupation: number | null;
  // Par mois (libellé = numéro du mois, comme les autres courbes) : offre, réservés et
  // séances portées par ces créneaux (> réservés dès qu'une jauge accueille plusieurs
  // réservations sur un même créneau).
  byMonth: { label: string; creneaux: number; reserves: number; seances: number }[];
};

export type SlotStatsType = "all" | "rec" | "uniq";

function inRange(d: string, from: string | null, to: string | null): boolean {
  return (!from || d >= from) && (!to || d <= to);
}

/**
 * @param slots créneaux datés du service (toute plage : filtrés ici)
 * @param seancesBySlot nombre de séances par identifiant de créneau (absent = libre)
 */
export function computeSlotStats(
  slots: SlotStatRow[],
  seancesBySlot: ReadonlyMap<string, number>,
  opts: { type: SlotStatsType; dateFrom: string | null; dateTo: string | null; today: string },
): SlotStats {
  const { type, dateFrom, dateTo, today } = opts;
  const pop = slots.filter(
    (s) =>
      inRange(s.date, dateFrom, dateTo) &&
      (type === "rec" ? s.parentSlotId != null : type === "uniq" ? s.parentSlotId == null : true),
  );
  const monthAgg = new Map<string, { creneaux: number; reserves: number; seances: number }>();
  let reserves = 0;
  let libresPasses = 0;
  for (const s of pop) {
    const seances = seancesBySlot.get(s.id) ?? 0;
    const booked = seances > 0;
    if (booked) reserves += 1;
    else if (s.date < today) libresPasses += 1;
    const bucket = s.date.slice(0, 7);
    const cur = monthAgg.get(bucket) ?? { creneaux: 0, reserves: 0, seances: 0 };
    cur.creneaux += 1;
    if (booked) cur.reserves += 1;
    cur.seances += seances;
    monthAgg.set(bucket, cur);
  }
  const creneaux = pop.length;
  return {
    creneaux,
    creneauxReserves: reserves,
    creneauxLibres: creneaux - reserves,
    creneauxLibresPasses: libresPasses,
    tauxOccupation: creneaux > 0 ? Math.round((100 * reserves) / creneaux) : null,
    byMonth: [...monthAgg.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, v]) => ({ label: String(Number(bucket.slice(5, 7))), ...v })),
  };
}
