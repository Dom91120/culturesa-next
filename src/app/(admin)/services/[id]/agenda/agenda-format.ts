// Helpers de formatage français des modales d'agenda (extraits de agenda-grid).

import { type AbsencePrevenue, absencePrevenueLabel } from "@/lib/agenda-core";

// Info-bulle d'une réservation au survol — format du legacy _badgeTitle :
//   Tel : <tel>      (si renseigné)
//   <email>
//   <N enfants M adulte(s)>
//   Niveau : <niveau>  (si renseigné dans la fiche usager — retour Dom 2026-09-04)
//   Absent : <motif>  (si la séance est pointée absente avec un motif saisi)
//   Absence prévenue par … le … [: motif]  (si une absence a été signalée à l'avance)
//   Verrouillée…      (si verrou pointage — sinon le badge change juste de curseur
//                      sans dire pourquoi, cf. incident du 2026-08-29)
export function badgeTitle(
  bk: {
    tel: string;
    email: string;
    enfants: number;
    accompagnants: number;
    /** Niveau déclaré par l'usager (réhydraté depuis la parente sur une occurrence). */
    niveau?: string;
    // Pointage de la réservation SURVOLÉE (l'occurrence, pas la parente) — le motif
    // n'a de sens que sur une séance absente.
    pointage?: string | null;
    pointageMotif?: string;
    absencePrevenue?: AbsencePrevenue | null;
    // Pour la formulation du verrou : occurrence (parentBookingId) ou parente
    // récurrente (bookingType) → « récurrente » ; ponctuelle autonome sinon.
    parentBookingId?: number | null;
    bookingType?: string;
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
  const niveau = bk.niveau?.trim();
  if (niveau) lines.push(`Niveau : ${niveau}`);
  const motif = bk.pointageMotif?.trim();
  if (bk.pointage === "absent" && motif) lines.push(`Absent : ${motif}`);
  if (bk.absencePrevenue) {
    // Le motif n'est cité ici que s'il ne l'a pas déjà été sur la ligne « Absent ».
    const m = motif && bk.pointage !== "absent" ? ` : ${motif}` : "";
    lines.push(`Absence ${absencePrevenueLabel(bk.absencePrevenue)}${m}`);
  }
  if (locked) {
    // Même formulation que l'infobulle du cadenas de la fiche (retour Dom 2026-08-29).
    const recurrente = bk.parentBookingId != null || bk.bookingType === "recurring";
    lines.push(
      recurrente
        ? "Réservation récurrente pointée : l'édition est verrouillée"
        : "Réservation pointée : l'édition est verrouillée",
    );
  }
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
