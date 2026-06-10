/**
 * Une date 'YYYY-MM-DD' tombe-t-elle dans une plage de vacances scolaires ?
 *
 * Convention data.education.gouv.fr (cf. legacy includes/holidays.php) :
 *   - `dateStart` = SOIR du dernier jour d'école → ce jour est ENCORE un jour d'école,
 *     donc le 1er jour de vacances = `dateStart + 1` → borne gauche STRICTE.
 *   - `dateEnd`   = soir du dernier jour de vacances (reprise le lendemain) → INCLUS.
 *
 * Soit l'intervalle de vacances = ] dateStart, dateEnd ].
 *
 * Les bornes et la date sont des chaînes ISO 'YYYY-MM-DD' : la comparaison
 * lexicographique équivaut à l'ordre chronologique.
 *
 * Source unique de vérité pour cette convention (agenda admin, agenda usager,
 * matérialisation des réservations-enfants) — évite que les copies divergent.
 */
export function isInSchoolHolidayRange(
  ymd: string,
  ranges: { dateStart: string; dateEnd: string }[],
): boolean {
  return ranges.some((r) => ymd > r.dateStart && ymd <= r.dateEnd);
}
