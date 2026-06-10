// Délai de réservation : date la plus proche réservable, à partir de
// `service.bookingDelay` (encodage legacy) et des jours actifs du service.
//   bookingDelay === 0            → aujourd'hui
//   0 < bookingDelay < 1000       → aujourd'hui (encodage minutes legacy, ignoré ici)
//   bookingDelay >= 1000          → aujourd'hui + (bookingDelay − 1000) jours CALENDAIRES
//   bookingDelay < 0              → aujourd'hui + |bookingDelay| jours OUVRÉS
//                                    (jours = jours actifs du service)
// « Aujourd'hui » = date calendaire à Paris. Tout est en chaînes ISO (YYYY-MM-DD)
// pour rester aligné sur les `slot.slotDate` (@db.Date).

const PARIS = "Europe/Paris";
const DOW = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const;

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

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dowKey = (iso: string) => DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()];

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
