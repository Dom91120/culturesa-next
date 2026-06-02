import type { CreneauxData, CreneauxSlot } from "@/server/services/slots";

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

export const DAY_CAP_FIELD: Record<DayKey, keyof CreneauxSlot> = {
  lun: "capLun",
  mar: "capMar",
  mer: "capMer",
  jeu: "capJeu",
  ven: "capVen",
  sam: "capSam",
  dim: "capDim",
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

// Next free start in morning (08:00-12:00) / afternoon (13:30-18:00) windows.
export function nextSlotStart(existingStarts: string[], dur: number): number {
  const taken = new Set(existingStarts.map((s) => timeToMin(s)));
  const windows: [number, number][] = [
    [480, 720],
    [810, 1080],
  ];
  for (const [start, endW] of windows) {
    let cur = start;
    while (cur + dur <= endW) {
      if (!taken.has(cur)) return cur;
      cur += dur;
    }
  }
  return windows[0][0];
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
