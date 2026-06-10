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

/**
 * Couleur d'une jauge de remplissage selon le pourcentage — SEUILS UNIQUES de
 * l'app (barres et compteurs des grilles agenda, jauge de la modale pile) :
 * vert < 70 %, orange ≥ 70 %, rouge à 100 %.
 */
export function gaugeColor(pct: number): string {
  return pct >= 100 ? "var(--danger)" : pct >= 70 ? "#e8a45a" : "var(--accent)";
}
