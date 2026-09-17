// Délai de réservation : date la plus proche réservable, à partir de
// `exercice.bookingDelay` (encodage legacy) et des jours actifs de l'exercice.
//   bookingDelay === 0            → aujourd'hui
//   0 < bookingDelay < 1000       → aujourd'hui (encodage minutes legacy, ignoré ici)
//   bookingDelay >= 1000          → aujourd'hui + (bookingDelay − 1000) jours CALENDAIRES
//   bookingDelay < 0              → aujourd'hui + |bookingDelay| jours OUVRÉS
//                                    (jours = jours actifs de l'exercice)
// « Aujourd'hui » = date calendaire à Paris. Tout est en chaînes ISO (YYYY-MM-DD)
// pour rester aligné sur les `slot.slotDate` (@db.Date).

import { ISO_DAY_KEYS } from "@/lib/agenda-core";
import { addDaysUtc, parseYmdUtc, ymdUtc } from "@/lib/date-utc";

const PARIS = "Europe/Paris";

/** Date calendaire d'aujourd'hui à Paris (YYYY-MM-DD). */
export function todayParisISO(now: Date = new Date()): string {
  // en-CA → "YYYY-MM-DD".
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PARIS,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Décalage d'une date ISO en jours (arithmétique UTC, cf. lib/date-utc).
const addDays = (iso: string, n: number): string => ymdUtc(addDaysUtc(parseYmdUtc(iso), n));

const dowKey = (iso: string) => ISO_DAY_KEYS[parseYmdUtc(iso).getUTCDay()];

/** Date ISO (YYYY-MM-DD) la plus proche réservable selon le délai du service. */
export function earliestBookableISO(
  bookingDelay: number,
  activeDays: string[],
  now: Date = new Date(),
): string {
  const today = todayParisISO(now);
  if (bookingDelay === 0 || (bookingDelay > 0 && bookingDelay < 1000)) return today;
  if (bookingDelay >= 1000) return addDays(today, bookingDelay - 1000);

  // Jours ouvrés (bookingDelay < 0) : on avance jusqu'à atteindre le nombre requis de
  // jours actifs STRICTEMENT après aujourd'hui (port legacy _earliestBookableDate).
  const required = Math.abs(bookingDelay);
  const workingDaysBetween = (to: string): number => {
    let count = 0;
    let c = addDays(today, 1);
    while (c < to) {
      if (activeDays.includes(dowKey(c))) count += 1;
      c = addDays(c, 1);
    }
    return count;
  };
  let d = today;
  let guard = 0;
  while (workingDaysBetween(d) < required && guard < 400) {
    d = addDays(d, 1);
    guard += 1;
  }
  return d;
}
