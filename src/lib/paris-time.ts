import { ISO_DAY_KEYS } from "@/lib/agenda-core";

// Calendrier Europe/Paris INDÉPENDANT du fuseau serveur (Node tourne en UTC) — SOURCE
// UNIQUE de la conversion instant ↔ heure murale FR + gestion DST (hiver/été), partagée
// par les crons auto-validation (auto-validate.ts) et digest gestionnaire (manager-notice.ts).

const TZ = "Europe/Paris";
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Minutes dont Paris est en avance sur UTC à cet instant (60 hiver / 120 été). */
function parisOffsetMin(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = dtf.formatToParts(instant);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

type ParisWall = { y: number; mo: number; da: number; min: number };

/** Instant → heure murale Paris (min = minutes depuis minuit). */
export function toParisWall(instant: Date): ParisWall {
  const w = new Date(instant.getTime() + parisOffsetMin(instant) * 60000);
  return {
    y: w.getUTCFullYear(),
    mo: w.getUTCMonth() + 1,
    da: w.getUTCDate(),
    min: w.getUTCHours() * 60 + w.getUTCMinutes(),
  };
}

/** Heure murale Paris (jour + minutes) → instant UTC. */
export function parisWallToInstant(y: number, mo: number, da: number, min: number): Date {
  const guess = Date.UTC(y, mo - 1, da, 0, min);
  return new Date(guess - parisOffsetMin(new Date(guess)) * 60000);
}

/** Instant → { date « YYYY-MM-DD », heure 0–23, jour de semaine } en heure murale Paris. */
export function parisParts(d: Date): {
  dateKey: string;
  hour: number;
  weekday: (typeof ISO_DAY_KEYS)[number];
} {
  const w = toParisWall(d);
  // Jour de semaine dérivé de la date murale via ISO_DAY_KEYS (source unique, index getDay 0=dim).
  const weekday = ISO_DAY_KEYS[new Date(Date.UTC(w.y, w.mo - 1, w.da)).getUTCDay()];
  return { dateKey: `${w.y}-${pad2(w.mo)}-${pad2(w.da)}`, hour: Math.floor(w.min / 60), weekday };
}
