// Helpers de formatage français des modales d'agenda (extraits de agenda-grid).

// Info-bulle d'une réservation au survol — format du legacy _badgeTitle :
//   Tel : <tel>      (si renseigné)
//   <email>
//   <N enfants M adulte(s)>
//   Absent : <motif>  (si la séance est pointée absente avec un motif saisi)
//   Verrouillée…      (si verrou pointage — sinon le badge change juste de curseur
//                      sans dire pourquoi, cf. incident du 2026-08-29)
export function badgeTitle(
  bk: {
    tel: string;
    email: string;
    enfants: number;
    accompagnants: number;
    // Pointage de la réservation SURVOLÉE (l'occurrence, pas la parente) — le motif
    // n'a de sens que sur une séance absente.
    pointage?: string | null;
    pointageMotif?: string;
  },
  locked = false,
): string {
  const lines: string[] = [];
  if (bk.tel.trim()) lines.push(`Tel : ${bk.tel.trim()}`);
  lines.push(bk.email);
  lines.push(
    `${bk.enfants} enfant${bk.enfants > 1 ? "s" : ""} ${bk.accompagnants} adulte${
      bk.accompagnants > 1 ? "s" : ""
    }`,
  );
  const motif = bk.pointageMotif?.trim();
  if (bk.pointage === "absent" && motif) lines.push(`Absent : ${motif}`);
  if (locked) lines.push("Verrouillée : séance pointée (dépointer pour modifier)");
  return lines.join("\n");
}

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
