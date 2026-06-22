// Helpers de formatage français des modales d'agenda (extraits de agenda-grid).

/** Accord pluriel des libellés de compteurs (cf. legacy _bdetUpdateLabels). */
export function plural(n: number, singular: string, plural: string): string {
  return n > 1 ? plural : singular;
}

// Heure « 9h » / « 9h30 » (port legacy _fmtHourFr : pas de zéro initial, « h » au lieu de « : »).
// Usage interne au module (fmtSlotHoursFr) → non exporté.
function fmtHourFr(t: string): string {
  const [h, m] = t.split(":");
  const hh = String(Number(h));
  return m && m !== "00" ? `${hh}h${m}` : `${hh}h`;
}

// Plage horaire « de 9h à 10h » ou « journée entière » (port legacy _fmtSlotHoursFr).
export function fmtSlotHoursFr(start?: string, end?: string): string {
  if (!start || !end) return "journée entière";
  return `de ${fmtHourFr(start)} à ${fmtHourFr(end)}`;
}

// Date longue française à partir d'un « YYYY-MM-DD ».
export function fmtDateLongFr(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
