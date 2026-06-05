import type { CreneauxData } from "@/server/services/slots";

export const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  lun: "Lun",
  mar: "Mar",
  mer: "Mer",
  jeu: "Jeu",
  ven: "Ven",
  sam: "Sam",
  dim: "Dim",
};

export const SLOT_PAGE_SIZE = 8;

// Durée « journée entière » (1 jour). Un créneau de cette durée n'a pas d'horaire :
// startTime/endTime vides (cf. legacy _isAllDay = !start_time && !end_time).
export const ALLDAY_DURATION = 1440;

// Un créneau est « journée entière » dès qu'il manque une de ses bornes horaires.
export function isAllDay(start: string, end: string): boolean {
  return !start || !end;
}

// Duration step ladder (minutes), matches legacy stepDuration.
const DURATION_STEPS = [30, 60, 90, 120, 150, 180, 210, 240, 300, ALLDAY_DURATION];

export function stepDuration(cur: number, dir: 1 | -1): number {
  let i = DURATION_STEPS.indexOf(cur);
  if (i < 0) i = 1;
  i += dir;
  if (i < 0) i = 0;
  if (i >= DURATION_STEPS.length) i = DURATION_STEPS.length - 1;
  return DURATION_STEPS[i];
}

export function formatDuration(min: number): string {
  if (min >= 1440) return min / 1440 > 1 ? `${min / 1440}j` : "1j";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${m < 10 ? "0" : ""}${m}`;
  if (h) return `${h}h`;
  return `${m}min`;
}

export function timeToMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = String(t).split(":");
  return (Number.parseInt(h, 10) || 0) * 60 + (Number.parseInt(m, 10) || 0);
}

export function minToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h < 10 ? "0" : ""}${h}:${mm < 10 ? "0" : ""}${mm}`;
}

export function addMinutes(t: string, m: number): string {
  return minToTime(timeToMin(t) + m);
}

// Prochain début de créneau disponible dans les plages d'ouverture du service
// (matin puis après-midi) : on empile juste après la fin du dernier créneau déjà
// placé dans la plage. Renvoie les minutes, ou null si plus de place dans aucune
// plage. Port fidèle du legacy nextSlotStart / nextSlotForDate (utilise les vraies
// morning/afternoon du service, pas une fenêtre figée). `ranges` = paires
// [début, fin] "HH:MM" (plage vide/inversée ignorée). `existing` = créneaux à
// considérer : tous pour le récurrent, ceux d'une date donnée pour le ponctuel.
export function nextSlotInRanges(
  existing: { startTime: string; endTime: string }[],
  dur: number,
  ranges: [string, string][],
): number | null {
  for (const [rangeStart, rangeEnd] of ranges) {
    const rsMin = timeToMin(rangeStart);
    const reMin = timeToMin(rangeEnd);
    if (reMin <= rsMin) continue;
    let fill = rsMin;
    for (const s of existing) {
      if (!s.startTime || !s.endTime) continue;
      const sMin = timeToMin(s.startTime);
      const eMin = timeToMin(s.endTime);
      if (sMin >= rsMin && eMin <= reMin) fill = Math.max(fill, eMin);
    }
    if (fill + dur <= reMin) return fill;
  }
  return null;
}

// Prochaine date (≥ lendemain) tombant un jour actif du service — port legacy
// nextWorkingDay. Renvoie 'YYYY-MM-DD'. Cherche sur 14 jours, sinon J+1.
export function nextWorkingDay(dateStr: string, activeDays: DayKey[]): string {
  const keys = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const;
  const base = new Date(`${dateStr}T00:00:00Z`);
  for (let i = 1; i <= 14; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    if (activeDays.includes(keys[d.getUTCDay()] as DayKey)) return d.toISOString().slice(0, 10);
  }
  return new Date(base.getTime() + 86400000).toISOString().slice(0, 10);
}

function isoWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function slotWeekTag(dateStr: string | null): "A" | "B" {
  if (!dateStr) return "A";
  return isoWeek(dateStr) % 2 === 0 ? "A" : "B";
}

export function parseWeeks(weeks: string | null | undefined): string[] {
  if (!weeks) return ["A", "B"];
  return String(weeks)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function activeDayKeys(service: CreneauxData["service"]): DayKey[] {
  return service.activeDays
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is DayKey => (DAY_KEYS as readonly string[]).includes(d));
}

export function newClientSlotId(): string {
  return `new_${Math.random().toString(36).slice(2, 10)}`;
}

export function isNewSlot(id: string): boolean {
  return id.startsWith("new_");
}
