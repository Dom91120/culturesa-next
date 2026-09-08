// Aides d'affichage de l'inactivité RGPD, partagées entre le panneau global
// (Administration › RGPD) et la vue par service (Paramètres › RGPD) pour que les deux
// écrans parlent le même langage (mêmes durées, même jauge).

/** Position du repère « seuil » sur la jauge : ce qui reste à droite montre le dépassement. */
export const GAUGE_THRESHOLD_PCT = 86;

/** « 2 ans 3 mois », « 4 jours », « aujourd'hui » (sans « il y a »). */
export function fmtSpan(days: number): string {
  if (days < 1) return "aujourd'hui";
  if (days < 30) return `${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mois`;
  let years = Math.floor(days / 365);
  let remMonths = Math.floor((days - years * 365) / 30);
  // 365 j = 12,17 mois de 30 j : le reste peut atteindre 12 → on bascule sur l'année.
  if (remMonths >= 12) {
    years += 1;
    remMonths = 0;
  }
  return remMonths
    ? `${years} an${years > 1 ? "s" : ""} ${remMonths} mois`
    : `${years} an${years > 1 ? "s" : ""}`;
}

/** Remplissage (%) et texte de la jauge d'inactivité pour un compte. */
export function gaugeFor(
  daysInactive: number,
  thresholdDays: number,
): { eligible: boolean; fill: number; text: string } {
  const eligible = daysInactive >= thresholdDays;
  // Au-delà du seuil, la barre file jusqu'au bout (en orange).
  const ratio = thresholdDays > 0 ? daysInactive / thresholdDays : 1;
  const fill = eligible
    ? 100
    : Math.max(1, Math.min(GAUGE_THRESHOLD_PCT, ratio * GAUGE_THRESHOLD_PCT));
  const text = eligible
    ? thresholdDays > 0
      ? `${fmtSpan(daysInactive)} · seuil dépassé de ${fmtSpan(daysInactive - thresholdDays)}`
      : `${fmtSpan(daysInactive)} · seuil à 0`
    : `${fmtSpan(daysInactive)} · encore ${fmtSpan(thresholdDays - daysInactive)}`;
  return { eligible, fill, text };
}
