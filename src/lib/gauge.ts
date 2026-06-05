/**
 * Nombre de « places » consommées par une réservation dans la jauge.
 * Toujours les enfants ; les accompagnants ne comptent que si le service a activé
 * « Jauge — prise en compte des accompagnants » (Service.gaugeAccompagnants).
 */
export function gaugeUnits(
  enfants: number,
  accompagnants: number,
  countAccompagnants: boolean,
): number {
  return enfants + (countAccompagnants ? accompagnants : 0);
}
