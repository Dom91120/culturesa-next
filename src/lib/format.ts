import { PARIS_TZ } from "@/lib/paris-time";
/**
 * Initiales d'un usager pour la pastille de la barre : 2 premières initiales du nom
 * (« Marie Curie » → « MC »), sinon 2 premières lettres du mot unique, sinon 1re lettre
 * de l'e-mail. Source unique des deux shells (connecté / usager).
 */
export function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] || "?").toUpperCase();
}

/** Formate une Date (ou null) en "YYYY-MM-DD" pour un <input type="date">. */
export function toDateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Mois abrégé fr-FR d'une clé « AAAA-MM » (« 2026-09 » → « sept. », « 2026-05 » → « mai »),
 * pour les tableaux « par mois » des statistiques (Dom 2026-09-15 : lettres plutôt que numéro).
 */
const MONTH_SHORT_FMT = new Intl.DateTimeFormat("fr-FR", { month: "short" });
export function monthShortLabel(bucket: string): string {
  const m = Number(bucket.slice(5, 7));
  if (!Number.isInteger(m) || m < 1 || m > 12) return bucket;
  return MONTH_SHORT_FMT.format(new Date(2000, m - 1, 1));
}

/**
 * Date courte fr-FR "JJ/MM/AAAA" d'un INSTANT — source unique (7 copies avant l'audit
 * 2026-07-18). Fuseau explicite : rendu identique serveur (UTC) / navigateur (Paris),
 * cf. PARIS_TZ. Une valeur `@db.Date` (minuit UTC) donne le même jour en Paris.
 */
export const DATE_FMT_FR = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: PARIS_TZ,
});

/** Idem, ancrée en UTC (dates `@db.Date`, sans dérive de fuseau à l'affichage). */
export const DATE_FMT_FR_UTC = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** Date + heure fr-FR "JJ/MM/AAAA HH:MM" d'un instant, heure de Paris (cf. PARIS_TZ). */
export const DATETIME_FMT_FR = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS_TZ,
});

/**
 * Saisie d'un NOM de famille : forcée en majuscules à la frappe (convention
 * « NOM Prénom » de l'application). Posée en `onInput` sur un champ NON contrôlé
 * (inscription, mon compte) ; un champ contrôlé passe simplement sa valeur par
 * `toUpperCase()` dans son `onChange`. La position du curseur est restaurée —
 * la casse ne change pas la longueur, une saisie au milieu du mot reste possible.
 */
export function upperCaseOnInput(e: React.FormEvent<HTMLInputElement>): void {
  const el = e.currentTarget;
  const upper = el.value.toUpperCase();
  if (upper === el.value) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = upper;
  if (start !== null && end !== null) el.setSelectionRange(start, end);
}

/**
 * Formate un numéro de téléphone FR en groupes de 2 chiffres : "06 12 34 56 78".
 * Renvoie "—" si vide, ou la valeur brute si ce n'est pas un 10 chiffres.
 * (Réimplémente formatTel du legacy public/js/app.js.)
 */
export function formatTel(tel: string | null | undefined): string {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "");
  if (d.length !== 10) return tel;
  return (d.match(/.{2}/g) ?? []).join(" ");
}

/** « il y a 3 j », « dans 27 j », « à l'instant »… (écart entre `iso` et `nowMs`). */
export function relativeLabel(iso: string, nowMs: number): string {
  const diff = new Date(iso).getTime() - nowMs;
  const min = Math.round(Math.abs(diff) / 60000);
  let txt: string;
  if (min < 1) txt = "moins d'une minute";
  else if (min < 60) txt = `${min} min`;
  else if (min < 48 * 60) txt = `${Math.round(min / 60)} h`;
  else txt = `${Math.round(min / 1440)} j`;
  return diff >= 0 ? `dans ${txt}` : `il y a ${txt}`;
}
