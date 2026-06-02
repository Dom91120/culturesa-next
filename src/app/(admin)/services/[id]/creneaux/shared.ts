import type { DayKey } from "./helpers";

export type { CreneauxData, CreneauxSlot } from "@/server/services/slots";
export type { DayKey } from "./helpers";
export {
  activeDayKeys,
  addMinutes,
  ALLDAY_DURATION,
  DAY_CAP_FIELD,
  DAY_KEYS,
  DAY_LABELS,
  formatDuration,
  isAllDay,
  isNewSlot,
  minToTime,
  newClientSlotId,
  nextSlotStart,
  parseWeeks,
  SLOT_PAGE_SIZE,
  slotWeekTag,
  stepDuration,
  timeToMin,
} from "./helpers";

export type SaveResult = { ok: true } | { ok: false; error?: string };

// Editable recurring slot (per-period buffer).
export type EditRecurSlot = {
  id: string;
  startTime: string;
  endTime: string;
  weeks: string;
  cap: Partial<Record<DayKey, number | null>>;
  demandeurIds: number[];
};

// Editable unique (manual) slot.
export type EditUniqueSlot = {
  id: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  demandeurIds: number[];
};
