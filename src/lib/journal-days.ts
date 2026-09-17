import { PARIS_TZ, parisParts } from "@/lib/paris-time";

// Regroupement par JOUR et heures des journaux (Journal des actions, RGPD), en heure de
// Paris quel que soit le fuseau du processus : la découpe « Aujourd'hui / Hier » et les
// heures « HH:MM » étaient calculées en UTC côté serveur (conteneur) et à Paris côté
// navigateur — texte différent, hydratation React rejetée (#418, prod 2026-09-17). Module
// sans React pour être testable tel quel.

const DAY_FMT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: PARIS_TZ,
});

/** Heure « HH:MM » d'un instant, heure de Paris. */
export const TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: PARIS_TZ,
});

/** Clés « YYYY-MM-DD » (Paris) d'aujourd'hui et d'hier, à partir de l'instant de génération. */
export function todayYesterdayKeys(generatedAtIso: string): {
  todayYmd: string;
  yesterdayYmd: string;
} {
  const now = new Date(generatedAtIso);
  return {
    todayYmd: parisParts(now).dateKey,
    yesterdayYmd: parisParts(new Date(now.getTime() - 86_400_000)).dateKey,
  };
}

/**
 * Libellé du jour d'un instant : « Aujourd'hui · Mercredi 17 septembre », « Hier · … »,
 * sinon « Mercredi 17 septembre » (année ajoutée si elle diffère de celle d'aujourd'hui).
 */
export function dayLabel(iso: string, todayYmd: string, yesterdayYmd: string): string {
  const d = new Date(iso);
  const ymd = parisParts(d).dateKey;
  const long = DAY_FMT.format(d);
  const cap = long.charAt(0).toUpperCase() + long.slice(1);
  if (ymd === todayYmd) return `Aujourd'hui · ${cap}`;
  if (ymd === yesterdayYmd) return `Hier · ${cap}`;
  const year = ymd.slice(0, 4);
  return `${cap}${year !== todayYmd.slice(0, 4) ? ` ${year}` : ""}`;
}
