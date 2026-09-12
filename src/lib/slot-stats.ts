// =====================================================================================
// Statistiques des CRÉNEAUX d'un service (fonctions pures, testées). Les Statistiques
// comptent des SÉANCES (occurrences datées réservées) ; ici on regarde l'OFFRE : les
// créneaux proposés, réservés ou non. Un créneau RÉCURRENT compte pour UN SEUL créneau
// (comme la carte « Créneaux ouverts » des Éditions), pas une fois par occurrence
// (précision Dom 2026-09-12) ; un ponctuel compte un. Les deux nombres divergent donc
// dès qu'il y a un récurrent, un créneau libre ou une jauge multi-réservations — c'est
// dans ce cas que l'écran affiche ce volet.
// =====================================================================================

export type SlotStatRow = {
  // Créneau DATÉ : miroir d'un récurrent (parentSlotId non null) ou ponctuel (null).
  id: string;
  date: string; // YYYY-MM-DD
  parentSlotId: string | null;
};

export type SlotStats = {
  // Créneaux proposés sur la plage : récurrents ayant au moins une occurrence dans la
  // plage (comptés UNE fois) + ponctuels datés dans la plage. Filtre de type appliqué.
  creneaux: number;
  // Créneaux portant au moins une séance (sur l'une quelconque de leurs occurrences).
  creneauxReserves: number;
  creneauxLibres: number;
  // Créneaux libres entièrement passés (dernière occurrence < aujourd'hui) : de l'offre
  // perdue, plus réservable.
  creneauxLibresPasses: number;
  // creneauxReserves / creneaux (%), null sans créneau.
  tauxOccupation: number | null;
  // Par mois (libellé = numéro du mois) : créneaux ayant une occurrence dans le mois
  // (un récurrent compte une fois par mois), ceux réservés dans le mois, et séances.
  byMonth: { label: string; creneaux: number; reserves: number; seances: number }[];
};

export type SlotStatsType = "all" | "rec" | "uniq";

function inRange(d: string, from: string | null, to: string | null): boolean {
  return (!from || d >= from) && (!to || d <= to);
}

/**
 * @param slots créneaux datés du service (toute plage : filtrés ici)
 * @param seancesBySlot nombre de séances par identifiant de créneau DATÉ (absent = libre)
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
  // Regroupement par CRÉNEAU : le récurrent parent pour un miroir, le ponctuel lui-même.
  const groups = new Map<string, { seances: number; lastDate: string }>();
  const monthAgg = new Map<
    string,
    { creneaux: Set<string>; reserves: Set<string>; seances: number }
  >();
  for (const s of pop) {
    const key = s.parentSlotId ?? s.id;
    const seances = seancesBySlot.get(s.id) ?? 0;
    const g = groups.get(key) ?? { seances: 0, lastDate: s.date };
    g.seances += seances;
    if (s.date > g.lastDate) g.lastDate = s.date;
    groups.set(key, g);
    const bucket = s.date.slice(0, 7);
    const m = monthAgg.get(bucket) ?? { creneaux: new Set(), reserves: new Set(), seances: 0 };
    m.creneaux.add(key);
    if (seances > 0) m.reserves.add(key);
    m.seances += seances;
    monthAgg.set(bucket, m);
  }
  let reserves = 0;
  let libresPasses = 0;
  for (const g of groups.values()) {
    if (g.seances > 0) reserves += 1;
    else if (g.lastDate < today) libresPasses += 1;
  }
  const creneaux = groups.size;
  return {
    creneaux,
    creneauxReserves: reserves,
    creneauxLibres: creneaux - reserves,
    creneauxLibresPasses: libresPasses,
    tauxOccupation: creneaux > 0 ? Math.round((100 * reserves) / creneaux) : null,
    byMonth: [...monthAgg.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, m]) => ({
        label: String(Number(bucket.slice(5, 7))),
        creneaux: m.creneaux.size,
        reserves: m.reserves.size,
        seances: m.seances,
      })),
  };
}
