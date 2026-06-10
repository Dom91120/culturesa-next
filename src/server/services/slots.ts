import { todayParisISO } from "@/lib/booking-delay";
import { slotWeekTag } from "@/lib/iso-week";
import type { SlotInput } from "@/schemas/config";
import { prisma } from "@/server/db";
import { getSchoolZone, syncChildrenForRecurringSlot } from "@/server/services/recurring-children";
import type { EntityState } from "@prisma/client";
import { type ServiceModes, deriveServiceModes } from "./service-modes";

// Ré-export pour les consommateurs qui importent slotWeekTag depuis ce module.
export { slotWeekTag };

// ─── Legacy CRUD (consumed by services/[id]/page.tsx + slot-actions.ts) ──

export function listSlotsForService(serviceId: string) {
  return prisma.slot.findMany({
    where: { serviceId },
    orderBy: [{ slotType: "asc" }, { startTime: "asc" }],
    include: {
      period: { select: { label: true } },
      demandeurs: { select: { demandeurId: true } },
    },
  });
}

function toSlotData(data: SlotInput) {
  return {
    serviceId: data.serviceId,
    slotType: data.slotType,
    startTime: data.startTime,
    endTime: data.endTime,
    slotDate: data.slotType === "unique" ? (data.slotDate ?? null) : null,
    slotDay: data.slotType === "recurring" ? (data.slotDay ?? null) : null,
    capacity: data.capacity ?? null,
    periodId: data.periodId ?? null,
    state: data.state,
  };
}

export function createSlot(data: SlotInput) {
  const id = `slot_${crypto.randomUUID().slice(0, 8)}`;
  return prisma.slot.create({ data: { id, ...toSlotData(data) } });
}

export function updateSlot(id: string, data: SlotInput) {
  return prisma.slot.update({ where: { id }, data: toSlotData(data) });
}

export function deleteSlot(id: string) {
  return prisma.slot.delete({ where: { id } });
}

// ─── Constants & helpers ───────────────────────────────────────────

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
type DayKey = (typeof DAY_KEYS)[number];

// ISO weekday (1=Mon..7=Sun) → day key.
const ISO_DOW_KEY: Record<number, DayKey> = {
  1: "lun",
  2: "mar",
  3: "mer",
  4: "jeu",
  5: "ven",
  6: "sam",
  7: "dim",
};

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fromISO(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function parseWeeks(weeks: string | null | undefined): string[] {
  if (!weeks) return ["A", "B"];
  return String(weeks)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function newRecurId(): string {
  return `sl_${crypto.randomUUID().slice(0, 8)}`;
}

function mirrorId(slotId: string, dateStr: string): string {
  return `u_${slotId}_${dateStr}`;
}

// ─── Read: full data needed by the Créneaux screen ─────────────────

export type CreneauxSlot = {
  id: string;
  slotType: string;
  startTime: string;
  endTime: string;
  slotDate: string | null;
  slotDay: string | null;
  capacity: number | null;
  periodId: number | null;
  parentSlotId: string | null;
  weeks: string | null;
  state: string;
  demandeurIds: number[];
  bookingCount: number;
};

export type CreneauxData = {
  service: {
    id: string;
    activeDays: string;
    openOnHolidays: boolean;
    semaineAb: boolean;
    duration: number;
    capacity: number;
    // Plages horaires d'ouverture (matin / après-midi) — bornent le placement
    // automatique des créneaux récurrents (cf. legacy nextSlotStart).
    morningStart: string;
    morningEnd: string;
    afternoonStart: string;
    afternoonEnd: string;
  };
  periods: { id: number; name: string; startDate: string; endDate: string }[];
  demandeurs: { id: number; name: string }[];
  slots: CreneauxSlot[];
  modes: ServiceModes;
};

export async function getCreneauxData(serviceId: string): Promise<CreneauxData | null> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return null;

  const [periods, demandeurs, rows] = await Promise.all([
    prisma.period.findMany({
      where: { serviceId, state: "actif" },
      orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    }),
    prisma.serviceDemandeurSettings.findMany({
      where: { serviceId },
      include: { demandeur: true },
      orderBy: { demandeur: { label: "asc" } },
    }),

    prisma.slot.findMany({
      where: { serviceId },
      orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
      include: {
        demandeurs: { select: { demandeurId: true } },
        bookings: { select: { id: true } },
      },
    }),
  ]);

  const modes = deriveServiceModes(
    demandeurs.map((row) => ({
      demandeurId: row.demandeurId,
      recurrent: row.recurrent,
      semaineAb: row.semaineAb,
      validation: row.validation,
      themes: row.themes,
      jauge: row.jauge,
    })),
  );

  return {
    service: {
      id: service.id,
      activeDays: service.activeDays,
      openOnHolidays: service.openOnHolidays,
      semaineAb: service.semaineAb,
      duration: service.duration,
      capacity: service.capacity,
      morningStart: service.morningStart,
      morningEnd: service.morningEnd,
      afternoonStart: service.afternoonStart,
      afternoonEnd: service.afternoonEnd,
    },
    periods: periods
      .filter((p) => p.dateStart != null && p.dateEnd != null)
      .map((p) => ({
        id: p.id,
        name: p.label,
        startDate: toISO(p.dateStart as Date),
        endDate: toISO(p.dateEnd as Date),
      })),
    demandeurs: demandeurs.map((s) => ({ id: s.demandeur.id, name: s.demandeur.label })),
    modes,
    slots: rows.map((s) => ({
      id: s.id,
      slotType: s.slotType,
      startTime: s.startTime,
      endTime: s.endTime,
      slotDate: s.slotDate ? toISO(s.slotDate) : null,
      slotDay: s.slotDay,
      capacity: s.capacity,
      periodId: s.periodId,
      parentSlotId: s.parentSlotId,
      weeks: s.weeks,
      state: s.state,
      demandeurIds: s.demandeurs.map((d) => d.demandeurId),
      bookingCount: s.bookings.length,
    })),
  };
}

// ─── Mirror generation (ported from api/slots.php save_recurring) ───

type RecurSlotInput = {
  id: string | null;
  startTime: string;
  endTime: string;
  weeks: string;
  slotDay: DayKey;
  capacity: number;
  demandeurIds: number[];
};

type WantedMirror = { date: string; cap: number };

// Compute the mirrors a recurring slot should have, given period range,
// active days, holidays (excluded unless openOnHolidays) and A/B filter.
// Modèle « un slot = un jour » : on ne génère des miroirs que pour les dates
// tombant sur `slotDay`, chacun avec la capacité unique du créneau.
function computeWantedMirrors(args: {
  startDate: string;
  endDate: string;
  activeDays: DayKey[];
  holidaySet: Set<string>;
  openOnHolidays: boolean;
  weeks: string[];
  slotDay: DayKey;
  capacity: number;
}): Map<string, WantedMirror> {
  const { startDate, endDate, activeDays, holidaySet, openOnHolidays, weeks, slotDay, capacity } =
    args;
  const wanted = new Map<string, WantedMirror>();
  if (!activeDays.includes(slotDay)) return wanted;
  let cur = fromISO(startDate);
  const end = fromISO(endDate);
  while (cur.getTime() <= end.getTime()) {
    const dateStr = toISO(cur);
    const dow = cur.getUTCDay() || 7; // 1=Mon..7=Sun
    const dayKey = ISO_DOW_KEY[dow];
    cur = new Date(cur.getTime() + 86400000);
    if (dayKey !== slotDay) continue;
    if (!openOnHolidays && holidaySet.has(dateStr)) continue;
    if (!weeks.includes(slotWeekTag(dateStr))) continue;
    wanted.set(dateStr, { date: dateStr, cap: capacity });
  }
  return wanted;
}

// ─── Save: recurring (type=recurring, period_id required) ──────────

export async function saveRecurringSlots(
  serviceId: string,
  periodId: number,
  slots: RecurSlotInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({ where: { id: periodId, serviceId } });
  if (!period) return { ok: false, error: "Période introuvable" };
  if (!period.dateStart || !period.dateEnd) {
    return { ok: false, error: "La période n'a pas de dates définies" };
  }

  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAY_KEYS.includes(d as DayKey));
  const openHol = service.openOnHolidays;
  const startDate = toISO(period.dateStart);
  const endDate = toISO(period.dateEnd);

  const holidays = await prisma.periodHoliday.findMany({
    where: { periodId },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toISO(h.date)));

  const validDemandeurs = new Set(
    (
      await prisma.serviceDemandeurSettings.findMany({
        where: { serviceId },
        select: { demandeurId: true },
      })
    ).map((s) => s.demandeurId),
  );

  const schoolZone = await getSchoolZone();

  await prisma.$transaction(async (tx) => {
    const keepIds: string[] = [];

    for (const sl of slots) {
      const slId = sl.id || newRecurId();
      keepIds.push(slId);
      const weeks = sl.weeks || "A,B";

      // upsert (preserve bookings)
      await tx.slot.upsert({
        where: { id: slId },
        update: {
          startTime: sl.startTime,
          endTime: sl.endTime,
          weeks,
          state: "actif",
          slotDay: sl.slotDay,
          capacity: sl.capacity,
        },
        create: {
          id: slId,
          serviceId,
          slotType: "recurring",
          startTime: sl.startTime,
          endTime: sl.endTime,
          periodId,
          weeks,
          state: "actif",
          slotDay: sl.slotDay,
          capacity: sl.capacity,
        },
      });

      // demandeurs: wipe + reinsert (filtered to service demandeurs)
      await tx.slotDemandeur.deleteMany({ where: { slotId: slId } });
      const dems = sl.demandeurIds.filter((d) => validDemandeurs.has(d));
      if (dems.length) {
        await tx.slotDemandeur.createMany({
          data: dems.map((demandeurId) => ({ slotId: slId, demandeurId })),
          skipDuplicates: true,
        });
      }

      // mirrors
      const wanted = computeWantedMirrors({
        startDate,
        endDate,
        activeDays,
        holidaySet,
        openOnHolidays: openHol,
        weeks: parseWeeks(weeks),
        slotDay: sl.slotDay,
        capacity: sl.capacity,
      });
      const existingMir = await tx.slot.findMany({
        where: { parentSlotId: slId },
        select: { id: true, state: true },
      });
      const mirById = new Map(existingMir.map((m) => [m.id, m.state]));

      for (const [, mv] of wanted) {
        const mid = mirrorId(slId, mv.date);
        if (mirById.has(mid)) {
          await tx.slot.update({
            where: { id: mid },
            data: {
              capacity: mv.cap,
              startTime: sl.startTime,
              endTime: sl.endTime,
              slotDate: fromISO(mv.date),
            },
          });
        } else {
          await tx.slot.create({
            data: {
              id: mid,
              serviceId,
              slotType: "unique",
              startTime: sl.startTime,
              endTime: sl.endTime,
              slotDate: fromISO(mv.date),
              capacity: mv.cap,
              periodId,
              parentSlotId: slId,
              state: "actif",
            },
          });
        }
      }
      // delete orphan mirrors (active only; keep désactivés)
      for (const [mid, mstate] of mirById) {
        const date = mid.slice(mirrorId(slId, "").length);
        if (!wanted.has(date) && mstate === "actif") {
          await tx.booking.deleteMany({ where: { slotId: mid } });
          await tx.slot.delete({ where: { id: mid } });
        }
      }

      // Miroirs régénérés → resynchronise les réservations-enfants des récurrentes
      // posées sur ce slot parent (occurrences ajoutées/retirées). Re-synchro (pas une
      // création usager) → on borne au présent, pas au délai de réservation.
      await syncChildrenForRecurringSlot(tx, slId, { schoolZone, cutoffISO: todayParisISO() });
    }

    // delete active recurring slots of the period absent from payload
    const existing = await tx.slot.findMany({
      where: { serviceId, slotType: "recurring", periodId, state: "actif" },
      select: { id: true },
    });
    for (const er of existing) {
      if (keepIds.includes(er.id)) continue;
      // cascade bookings + active mirrors (keep désactivés)
      await tx.booking.deleteMany({ where: { slotId: er.id } });
      const mirrors = await tx.slot.findMany({
        where: { parentSlotId: er.id },
        select: { id: true, state: true },
      });
      const activeMir = mirrors.filter((m) => m.state === "actif").map((m) => m.id);
      if (activeMir.length) {
        await tx.booking.deleteMany({ where: { slotId: { in: activeMir } } });
        await tx.slot.deleteMany({ where: { id: { in: activeMir } } });
      }
      await tx.slot.delete({ where: { id: er.id } });
    }
  });

  return { ok: true };
}

// ─── Save: unique (type=unique) ────────────────────────────────────

type UniqueSlotInput = {
  id: string | null;
  parentSlotId?: string | null;
  startTime: string;
  endTime: string;
  slotDate: string | null;
  capacity: number | null;
};

export async function saveUniqueSlots(
  serviceId: string,
  slots: UniqueSlotInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };

  try {
    await prisma.$transaction(async (tx) => {
      // manual unique slots (no parent): delete active + reinsert
      await tx.slot.deleteMany({
        where: { serviceId, slotType: "unique", parentSlotId: null, state: "actif" },
      });
      for (const sl of slots) {
        if (sl.parentSlotId) {
          // mirror: update capacity only
          await tx.slot.update({
            where: { id: sl.id ?? "" },
            data: { capacity: sl.capacity },
          });
          continue;
        }
        const dateStr = sl.slotDate;
        if (!dateStr) continue;
        // resolve period by date (must be active)
        const period = await tx.period.findFirst({
          where: {
            serviceId,
            state: "actif",
            dateStart: { lte: fromISO(dateStr) },
            dateEnd: { gte: fromISO(dateStr) },
          },
          select: { id: true },
        });
        if (!period) {
          throw new Error(`Aucune période active ne couvre la date ${dateStr}`);
        }
        await tx.slot.create({
          data: {
            id: sl.id || newRecurId(),
            serviceId,
            slotType: "unique",
            startTime: sl.startTime,
            endTime: sl.endTime,
            slotDate: fromISO(dateStr),
            capacity: sl.capacity,
            periodId: period.id,
            state: "actif",
          },
        });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  return { ok: true };
}

// ─── Ajout d'UN créneau depuis l'agenda (mode « Création de créneau ») ──────────
// Contrairement à saveRecurringSlots/saveUniqueSlots (upsert en masse qui remplace
// la liste), ces helpers ajoutent un seul créneau sans toucher aux autres.

/** Ajoute un créneau RÉCURRENT (+ ses miroirs) pour une période/jour donnés. */
export async function addRecurringSlot(
  serviceId: string,
  periodId: number,
  input: { startTime: string; endTime: string; weeks: string; dayKey: DayKey; capacity: number },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({ where: { id: periodId, serviceId } });
  if (!period?.dateStart || !period?.dateEnd) {
    return { ok: false, error: "Période introuvable ou sans dates" };
  }
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAY_KEYS.includes(d as DayKey));
  const weeks = input.weeks || "A,B";
  const holidays = await prisma.periodHoliday.findMany({
    where: { periodId },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toISO(h.date)));
  // Hoisté hors transaction : la restriction de nullité ne survit pas dans la closure.
  const startDate = toISO(period.dateStart);
  const endDate = toISO(period.dateEnd);
  const slId = newRecurId();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.slot.create({
        data: {
          id: slId,
          serviceId,
          slotType: "recurring",
          startTime: input.startTime,
          endTime: input.endTime,
          periodId,
          weeks,
          state: "actif",
          slotDay: input.dayKey,
          capacity: input.capacity,
        },
      });
      const wanted = computeWantedMirrors({
        startDate,
        endDate,
        activeDays,
        holidaySet,
        openOnHolidays: service.openOnHolidays,
        weeks: parseWeeks(weeks),
        slotDay: input.dayKey,
        capacity: input.capacity,
      });
      for (const [, mv] of wanted) {
        await tx.slot.create({
          data: {
            id: mirrorId(slId, mv.date),
            serviceId,
            slotType: "unique",
            startTime: input.startTime,
            endTime: input.endTime,
            slotDate: fromISO(mv.date),
            capacity: mv.cap,
            periodId,
            parentSlotId: slId,
            state: "actif",
          },
        });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  return { ok: true, id: slId };
}

/**
 * Copie les créneaux récurrents d'une semaine A/B vers l'autre (même période). Pour
 * chaque créneau qui tourne sur `fromWeek` mais PAS sur `toWeek`, crée un créneau
 * identique sur `toWeek` : mêmes horaires, capacités par-jour, demandeurs autorisés,
 * + miroirs. Ignore les créneaux déjà « A,B » (présents sur les deux) et les doublons
 * (un créneau identique existant déjà sur `toWeek`). Ne supprime rien.
 */
export async function copyRecurringWeek(
  serviceId: string,
  periodId: number,
  fromWeek: "A" | "B",
  toWeek: "A" | "B",
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  if (fromWeek === toWeek) return { ok: false, error: "Semaines identiques" };
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({ where: { id: periodId, serviceId } });
  if (!period?.dateStart || !period?.dateEnd) {
    return { ok: false, error: "Période introuvable ou sans dates" };
  }
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAY_KEYS.includes(d as DayKey));
  const holidays = await prisma.periodHoliday.findMany({
    where: { periodId },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toISO(h.date)));
  const startDate = toISO(period.dateStart);
  const endDate = toISO(period.dateEnd);

  const slots = await prisma.slot.findMany({
    where: { serviceId, periodId, slotType: "recurring", state: "actif" },
  });
  const sig = (s: (typeof slots)[number]) =>
    [s.startTime, s.endTime, s.slotDay ?? "", s.capacity ?? ""].join("|");

  // Signatures déjà présentes sur toWeek (anti-doublon).
  const existingOnTo = new Set(slots.filter((s) => parseWeeks(s.weeks).includes(toWeek)).map(sig));
  // À copier : tourne sur fromWeek, pas sur toWeek, et pas déjà présent à l'identique.
  const toCopy = slots.filter(
    (s) =>
      parseWeeks(s.weeks).includes(fromWeek) &&
      !parseWeeks(s.weeks).includes(toWeek) &&
      !existingOnTo.has(sig(s)),
  );

  // Demandeurs autorisés des créneaux sources.
  const demRows = toCopy.length
    ? await prisma.slotDemandeur.findMany({
        where: { slotId: { in: toCopy.map((s) => s.id) } },
        select: { slotId: true, demandeurId: true },
      })
    : [];
  const demBySlot = new Map<string, number[]>();
  for (const r of demRows) {
    const list = demBySlot.get(r.slotId) ?? [];
    list.push(r.demandeurId);
    demBySlot.set(r.slotId, list);
  }

  let created = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const s of toCopy) {
        // Un créneau récurrent sans slotDay (ne devrait pas exister) est ignoré.
        if (!s.slotDay) continue;
        const newId = newRecurId();
        await tx.slot.create({
          data: {
            id: newId,
            serviceId,
            slotType: "recurring",
            startTime: s.startTime,
            endTime: s.endTime,
            periodId,
            weeks: toWeek,
            state: "actif",
            slotDay: s.slotDay,
            capacity: s.capacity,
          },
        });
        const wanted = computeWantedMirrors({
          startDate,
          endDate,
          activeDays,
          holidaySet,
          openOnHolidays: service.openOnHolidays,
          weeks: parseWeeks(toWeek),
          slotDay: s.slotDay,
          capacity: s.capacity ?? service.capacity,
        });
        for (const [, mv] of wanted) {
          await tx.slot.create({
            data: {
              id: mirrorId(newId, mv.date),
              serviceId,
              slotType: "unique",
              startTime: s.startTime,
              endTime: s.endTime,
              slotDate: fromISO(mv.date),
              capacity: mv.cap,
              periodId,
              parentSlotId: newId,
              state: "actif",
            },
          });
        }
        const ids = demBySlot.get(s.id);
        if (ids?.length) {
          await tx.slotDemandeur.createMany({
            data: ids.map((demandeurId) => ({ slotId: newId, demandeurId })),
          });
        }
        created++;
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  return { ok: true, created };
}

/** Ajoute un créneau PONCTUEL daté (période résolue depuis la date). */
export async function addUniqueSlot(
  serviceId: string,
  input: { slotDate: string; startTime: string; endTime: string; capacity: number },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({
    where: {
      serviceId,
      state: "actif",
      dateStart: { lte: fromISO(input.slotDate) },
      dateEnd: { gte: fromISO(input.slotDate) },
    },
    select: { id: true },
  });
  if (!period) {
    return { ok: false, error: `Aucune période active ne couvre la date ${input.slotDate}` };
  }
  const id = newRecurId();
  await prisma.slot.create({
    data: {
      id,
      serviceId,
      slotType: "unique",
      startTime: input.startTime,
      endTime: input.endTime,
      slotDate: fromISO(input.slotDate),
      capacity: input.capacity,
      periodId: period.id,
      state: "actif",
    },
  });
  return { ok: true, id };
}

// ─── Déplacement d'UN créneau vide depuis l'agenda (mode « Création ») ──────────
// Refusé s'il porte la moindre réservation (créneau OU miroirs). Récurrent : maj
// horaires + jour (déplace la capacité du jour, régénère les miroirs). Ponctuel :
// maj horaires + date (période re-résolue).

export async function moveRecurringSlot(
  serviceId: string,
  slotId: string,
  _fromDayKey: DayKey,
  toDayKey: DayKey,
  startTime: string,
  endTime: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const slot = await prisma.slot.findFirst({
    where: { id: slotId, serviceId, slotType: "recurring" },
  });
  if (!slot) return { ok: false, error: "Créneau introuvable" };
  const period = await prisma.period.findFirst({ where: { id: slot.periodId ?? 0, serviceId } });
  if (!period?.dateStart || !period?.dateEnd) {
    return { ok: false, error: "Période introuvable ou sans dates" };
  }
  const existingMirrors = await prisma.slot.findMany({
    where: { parentSlotId: slotId },
    select: { id: true },
  });
  const bookingCount = await prisma.booking.count({
    where: { slotId: { in: [slotId, ...existingMirrors.map((m) => m.id)] } },
  });
  if (bookingCount > 0) {
    return { ok: false, error: "Créneau avec réservation : déplacement impossible." };
  }

  const capVal = slot.capacity ?? service.capacity;
  const weeks = slot.weeks || "A,B";
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAY_KEYS.includes(d as DayKey));
  const holidays = await prisma.periodHoliday.findMany({
    where: { periodId: period.id },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toISO(h.date)));
  const startDate = toISO(period.dateStart);
  const endDate = toISO(period.dateEnd);
  try {
    await prisma.$transaction(async (tx) => {
      if (existingMirrors.length) {
        await tx.slot.deleteMany({ where: { id: { in: existingMirrors.map((m) => m.id) } } });
      }
      await tx.slot.update({
        where: { id: slotId },
        data: { startTime, endTime, weeks, state: "actif", slotDay: toDayKey, capacity: capVal },
      });
      const wanted = computeWantedMirrors({
        startDate,
        endDate,
        activeDays,
        holidaySet,
        openOnHolidays: service.openOnHolidays,
        weeks: parseWeeks(weeks),
        slotDay: toDayKey,
        capacity: capVal,
      });
      for (const [, mv] of wanted) {
        await tx.slot.create({
          data: {
            id: mirrorId(slotId, mv.date),
            serviceId,
            slotType: "unique",
            startTime,
            endTime,
            slotDate: fromISO(mv.date),
            capacity: mv.cap,
            periodId: period.id,
            parentSlotId: slotId,
            state: "actif",
          },
        });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  return { ok: true };
}

export async function moveUniqueSlot(
  serviceId: string,
  slotId: string,
  slotDate: string,
  startTime: string,
  endTime: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const slot = await prisma.slot.findFirst({
    where: { id: slotId, serviceId, slotType: "unique" },
  });
  if (!slot) return { ok: false, error: "Créneau introuvable" };
  if (slot.parentSlotId) return { ok: false, error: "Un miroir ne se déplace pas directement." };
  const bookingCount = await prisma.booking.count({ where: { slotId } });
  if (bookingCount > 0) {
    return { ok: false, error: "Créneau avec réservation : déplacement impossible." };
  }
  const period = await prisma.period.findFirst({
    where: {
      serviceId,
      state: "actif",
      dateStart: { lte: fromISO(slotDate) },
      dateEnd: { gte: fromISO(slotDate) },
    },
    select: { id: true },
  });
  if (!period) return { ok: false, error: `Aucune période active ne couvre la date ${slotDate}` };
  await prisma.slot.update({
    where: { id: slotId },
    data: { startTime, endTime, slotDate: fromISO(slotDate), periodId: period.id },
  });
  return { ok: true };
}

// ─── delete (suppression immédiate, fidèle au legacy) ──────────────
// Supprime des créneaux et tout ce qui en dépend : pour un récurrent, ses
// miroirs (slot_type=unique avec parentSlotId) + leurs réservations + ses
// propres réservations. Pour un ponctuel, ses réservations. Refuse si le
// créneau (ou un de ses miroirs) porte des réservations ? Non : le legacy
// supprime en cascade — la garde "réservé" est faite côté UI avant l'appel.
export async function deleteSlots(
  serviceId: string,
  ids: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  if (!ids.length) return { ok: true, deleted: 0 };
  // Sécurité : ne supprimer que des créneaux du service ciblé.
  const owned = await prisma.slot.findMany({
    where: { id: { in: ids }, serviceId },
    select: { id: true },
  });
  const ownedIds = owned.map((s) => s.id);
  if (!ownedIds.length) return { ok: true, deleted: 0 };

  await prisma.$transaction(async (tx) => {
    // Miroirs des récurrents ciblés.
    const mirrors = await tx.slot.findMany({
      where: { parentSlotId: { in: ownedIds } },
      select: { id: true },
    });
    const mirrorIds = mirrors.map((m) => m.id);
    const allSlotIds = [...ownedIds, ...mirrorIds];
    // Réservations rattachées (récurrentes sur le slot + uniques sur les miroirs).
    await tx.booking.deleteMany({ where: { slotId: { in: allSlotIds } } });
    // Miroirs d'abord (pas de FK sur parentSlotId, mais on reste explicite).
    if (mirrorIds.length) await tx.slot.deleteMany({ where: { id: { in: mirrorIds } } });
    await tx.slot.deleteMany({ where: { id: { in: ownedIds } } });
  });
  return { ok: true, deleted: ownedIds.length };
}

// ─── set_state ─────────────────────────────────────────────────────

export async function setSlotsState(
  ids: string[],
  state: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (!["actif", "desactive", "archive"].includes(state)) {
    return { ok: false, error: "État invalide" };
  }
  if (!ids.length) return { ok: true, updated: 0 };
  const newState = state as EntityState;
  await prisma.$transaction([
    prisma.slot.updateMany({ where: { id: { in: ids } }, data: { state: newState } }),
    // propagate to mirrors of targeted recurring slots
    prisma.slot.updateMany({ where: { parentSlotId: { in: ids } }, data: { state: newState } }),
  ]);
  return { ok: true, updated: ids.length };
}

// ─── set_demandeurs ────────────────────────────────────────────────

export async function setSlotDemandeurs(
  slotId: string,
  demandeurIds: number[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    select: { parentSlotId: true, serviceId: true },
  });
  if (!slot) return { ok: false, error: "Créneau introuvable" };
  if (slot.parentSlotId) return { ok: false, error: "Impossible sur un créneau miroir" };

  const valid = new Set(
    (
      await prisma.serviceDemandeurSettings.findMany({
        where: { serviceId: slot.serviceId },
        select: { demandeurId: true },
      })
    ).map((s) => s.demandeurId),
  );
  const filtered = demandeurIds.filter((d) => valid.has(d));

  await prisma.$transaction([
    prisma.slotDemandeur.deleteMany({ where: { slotId } }),
    prisma.slotDemandeur.createMany({
      data: filtered.map((demandeurId) => ({ slotId, demandeurId })),
      skipDuplicates: true,
    }),
  ]);
  return { ok: true };
}
