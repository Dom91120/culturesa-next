import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { DayOfWeek, Prisma } from "@prisma/client";

// =====================================================================================
// Types
// =====================================================================================

export type CycleOptions = {
  recreatePeriods: boolean;
  recreateSlots: boolean;
};

export type CycleResult = {
  created: number;
  slotsCreated: number;
};

export type UndoInfo = {
  hasUndo: boolean;
  createdAt: string | null;
  bookingsCount: number;
};

export type ExercicePaneData = {
  currentName: string;
  nextName: string;
  currentRange: { start: string; end: string } | null;
  hasActivePeriods: boolean;
  showPreviousExercices: boolean;
  undo: UndoInfo;
};

type CycleEventData = {
  archivedPeriodIds: number[];
  newPeriodIds: number[];
  newRecurringSlotIds: string[];
  newMirrorSlotIds: string[];
  oldDeactivatedPeriodIds: number[];
};

// =====================================================================================
// Helpers — dates
// =====================================================================================

/** Date (colonne @db.Date) → « YYYY-MM-DD » en UTC ; null → null. */
function fmtDateUtc(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** « YYYY-MM-DD » → Date (UTC minuit). */
function dateFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

/**
 * Décale une date « YYYY-MM-DD » d'un an. Gère le 29 février : si l'année cible
 * n'est pas bissextile, retombe sur le 28 février.
 */
export function shiftDateOneYear(date: string | null): string | null {
  if (!date) return null;
  const y = Number.parseInt(date.slice(0, 4), 10);
  const m = Number.parseInt(date.slice(5, 7), 10);
  let d = Number.parseInt(date.slice(8, 10), 10);
  const ny = y + 1;
  if (m === 2 && d === 29 && !isLeapYear(ny)) d = 28;
  return `${pad4(ny)}-${pad2(m)}-${pad2(d)}`;
}

/** Jour ISO 1..7 (1 = lundi, 7 = dimanche) d'une date UTC. */
function isoDay(d: Date): number {
  const day = d.getUTCDay(); // 0 = dimanche
  return day === 0 ? 7 : day;
}

/** Numéro de semaine ISO 8601 d'une date UTC. */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = lundi
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // jeudi de la semaine
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const diff = date.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

// =====================================================================================
// Helpers — jours fériés français
// =====================================================================================

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), en UTC. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Jours fériés légaux français (fixes + mobiles liés à Pâques) d'une année. */
export function frenchHolidays(year: number): { date: string; label: string }[] {
  const fmt = (d: Date) =>
    `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const easter = easterSunday(year);
  const list: { date: string; label: string }[] = [
    { date: `${pad4(year)}-01-01`, label: "Jour de l'an" },
    { date: `${pad4(year)}-05-01`, label: "Fête du Travail" },
    { date: `${pad4(year)}-05-08`, label: "Victoire 1945" },
    { date: `${pad4(year)}-07-14`, label: "Fête nationale" },
    { date: `${pad4(year)}-08-15`, label: "Assomption" },
    { date: `${pad4(year)}-11-01`, label: "Toussaint" },
    { date: `${pad4(year)}-11-11`, label: "Armistice 1918" },
    { date: `${pad4(year)}-12-25`, label: "Noël" },
    { date: fmt(addDaysUtc(easter, 1)), label: "Lundi de Pâques" },
    { date: fmt(addDaysUtc(easter, 39)), label: "Ascension" },
    { date: fmt(addDaysUtc(easter, 50)), label: "Lundi de Pentecôte" },
  ];
  return list;
}

/** Jours fériés français sur l'intervalle [start, end] (bornes incluses). */
export function holidaysInRange(start: string, end: string): { date: string; label: string }[] {
  const ys = Number.parseInt(start.slice(0, 4), 10);
  const ye = Number.parseInt(end.slice(0, 4), 10);
  const out: { date: string; label: string }[] = [];
  for (let y = ys; y <= ye; y++) {
    for (const h of frenchHolidays(y)) {
      if (h.date >= start && h.date <= end) out.push(h);
    }
  }
  return out;
}

// =====================================================================================
// Helpers — exercice (label) + activeDays + capacités
// =====================================================================================

/**
 * Construit le libellé d'un exercice à partir des années min/max des dates :
 * « Y » si une seule année, sinon « Y1-Y2 ».
 */
function exerciceLabel(startYear: number, endYear: number): string {
  return startYear === endYear ? String(startYear) : `${startYear}-${endYear}`;
}

/**
 * Upsert d'un exercice par libellé dans une transaction. Renvoie son id.
 * (Variante transactionnelle de `ensureExercice` de periods.ts, qui n'accepte
 * qu'une année de début ; ici le libellé peut être « Y » ou « Y1-Y2 ».)
 */
async function ensureExerciceTx(tx: Prisma.TransactionClient, label: string): Promise<number> {
  const existing = await tx.exercice.findFirst({
    where: { label },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.exercice.create({ data: { label }, select: { id: true } });
  return created.id;
}

/**
 * Parse la colonne Service.activeDays vers un tableau d'entiers ISO 1..7.
 * Tolère le format numérique (« 1,2,3,4,5 ») et le format clé (« lun,mar,… »).
 */
function parseActiveDays(raw: string): number[] {
  const keyToIso: Record<string, number> = {
    lun: 1,
    mar: 2,
    mer: 3,
    jeu: 4,
    ven: 5,
    sam: 6,
    dim: 7,
  };
  const out: number[] = [];
  for (const tok of raw.split(",")) {
    const t = tok.trim().toLowerCase();
    if (!t) continue;
    const num = Number.parseInt(t, 10);
    if (Number.isInteger(num) && num >= 1 && num <= 7) out.push(num);
    else if (t in keyToIso) out.push(keyToIso[t]);
  }
  return out;
}

type SlotSnapshot = {
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDay: DayOfWeek | null;
  weeks: string | null;
};

// Jour de la semaine (clé) pour un jour ISO 1..7.
const ISO_KEY: Record<number, string> = {
  1: "lun",
  2: "mar",
  3: "mer",
  4: "jeu",
  5: "ven",
  6: "sam",
  7: "dim",
};

/** Capacité du jour ISO (1..7) pour un slot mono-jour : non nulle uniquement le jour
 *  du créneau (slotDay). */
function capForDay(slot: SlotSnapshot, iso: number): number | null {
  return slot.slotDay === ISO_KEY[iso] ? slot.capacity : null;
}

/**
 * Génère les miroirs uniques (« u_<slotId>_<date> ») d'un créneau récurrent
 * cloné sur [rangeStart, rangeEnd], pour chaque jour actif du service, en
 * excluant les fériés si !openOnHolidays et en respectant le filtre semaines
 * A/B (A = semaine ISO paire, B = impaire). Capacité miroir = cap du jour.
 * Renvoie les ids créés.
 */
async function generateMirrorSlots(
  tx: Prisma.TransactionClient,
  params: {
    serviceId: string;
    slotId: string;
    periodId: number;
    src: SlotSnapshot;
    rangeStart: string;
    rangeEnd: string;
    activeDays: number[];
    openOnHolidays: boolean;
  },
): Promise<string[]> {
  const { serviceId, slotId, periodId, src, rangeStart, rangeEnd, activeDays, openOnHolidays } =
    params;

  const holidaySet = new Set<string>();
  if (!openOnHolidays) {
    for (const h of holidaysInRange(rangeStart, rangeEnd)) holidaySet.add(h.date);
  }

  const created: string[] = [];
  const end = dateFromYmd(rangeEnd);
  const cursor = dateFromYmd(rangeStart);

  while (cursor.getTime() <= end.getTime()) {
    const iso = isoDay(cursor);
    const dateStr = `${pad4(cursor.getUTCFullYear())}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    if (activeDays.includes(iso) && !holidaySet.has(dateStr)) {
      let weekOk = true;
      if (src.weeks === "A" || src.weeks === "B") {
        const isEven = isoWeek(cursor) % 2 === 0;
        weekOk = src.weeks === "A" ? isEven : !isEven;
      }
      const cap = capForDay(src, iso);
      if (weekOk && cap !== null) {
        const mid = `u_${slotId}_${dateStr}`;
        await tx.slot.create({
          data: {
            id: mid,
            serviceId,
            slotType: "unique",
            startTime: src.startTime,
            endTime: src.endTime,
            slotDate: dateFromYmd(dateStr),
            capacity: cap,
            periodId,
            parentSlotId: slotId,
            weeks: null,
            state: "actif",
          },
        });
        created.push(mid);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return created;
}

// =====================================================================================
// CYCLE — création du prochain exercice
// =====================================================================================

export async function cycleService(serviceId: string, opts: CycleOptions): Promise<CycleResult> {
  const { recreateSlots } = opts;

  return prisma.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new Error("Service introuvable.");

    // 1. périodes actives triées (date_start nulls last, id)
    const actives = await tx.period.findMany({
      where: { serviceId, state: "actif" },
      orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    });
    if (actives.length === 0) {
      throw new Error("Aucune période active à reconduire.");
    }

    // 2. snapshot des créneaux récurrents actifs par période active
    const slotsByPeriod = new Map<number, SlotSnapshot[]>();
    for (const p of actives) {
      const slots = await tx.slot.findMany({
        where: { serviceId, periodId: p.id, slotType: "recurring", state: "actif" },
      });
      slotsByPeriod.set(
        p.id,
        slots.map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity,
          slotDay: s.slotDay,
          weeks: s.weeks,
        })),
      );
    }

    // 3. capture des périodes désactivées (à archiver)
    const deactivated = await tx.period.findMany({
      where: { serviceId, state: "desactive" },
      select: { id: true },
    });
    const archivedPeriodIds = deactivated.map((r) => r.id);

    // 4. désactivées → archivées
    if (archivedPeriodIds.length > 0) {
      await tx.period.updateMany({
        where: { id: { in: archivedPeriodIds } },
        data: { state: "archive" },
      });
    }

    // 5. label du nouvel exercice (dates décalées +1 an)
    const shiftedStartYears = actives
      .map((p) => shiftDateOneYear(fmtDateUtc(p.dateStart)))
      .filter((d): d is string => d !== null)
      .map((d) => Number.parseInt(d.slice(0, 4), 10));
    const shiftedEndYears = actives
      .map((p) => shiftDateOneYear(fmtDateUtc(p.dateEnd)))
      .filter((d): d is string => d !== null)
      .map((d) => Number.parseInt(d.slice(0, 4), 10));
    const years = [...shiftedStartYears, ...shiftedEndYears];
    const startYear = years.length > 0 ? Math.min(...years) : new Date().getUTCFullYear() + 1;
    const endYear = years.length > 0 ? Math.max(...years) : startYear;
    const exId = await ensureExerciceTx(tx, exerciceLabel(startYear, endYear));

    // 6. recopie des périodes
    const activeDays = parseActiveDays(service.activeDays);
    const newPeriodIds: number[] = [];
    const newRecurringSlotIds: string[] = [];
    const newMirrorSlotIds: string[] = [];

    for (const p of actives) {
      const ns = shiftDateOneYear(fmtDateUtc(p.dateStart));
      const ne = shiftDateOneYear(fmtDateUtc(p.dateEnd));

      const newPeriod = await tx.period.create({
        data: {
          serviceId,
          exerciceId: exId,
          label: p.label,
          etiquette: p.etiquette,
          dateStart: ns ? dateFromYmd(ns) : null,
          dateEnd: ne ? dateFromYmd(ne) : null,
          color: p.color,
          position: p.position,
          state: "actif",
        },
      });
      newPeriodIds.push(newPeriod.id);

      // fériés de la nouvelle période
      if (ns && ne) {
        for (const h of holidaysInRange(ns, ne)) {
          await tx.periodHoliday.create({
            data: { periodId: newPeriod.id, date: dateFromYmd(h.date), label: h.label },
          });
        }
      }

      // créneaux
      if (recreateSlots) {
        const snapshot = slotsByPeriod.get(p.id) ?? [];
        for (const s of snapshot) {
          const newSlotId = `sl_${randomUUID().slice(0, 8)}`;
          await tx.slot.create({
            data: {
              id: newSlotId,
              serviceId,
              slotType: "recurring",
              startTime: s.startTime,
              endTime: s.endTime,
              slotDate: null,
              capacity: s.capacity,
              slotDay: s.slotDay,
              periodId: newPeriod.id,
              parentSlotId: null,
              weeks: s.weeks,
              state: "actif",
            },
          });
          newRecurringSlotIds.push(newSlotId);

          if (ns && ne) {
            const mirrors = await generateMirrorSlots(tx, {
              serviceId,
              slotId: newSlotId,
              periodId: newPeriod.id,
              src: s,
              rangeStart: ns,
              rangeEnd: ne,
              activeDays,
              openOnHolidays: service.openOnHolidays,
            });
            for (const mid of mirrors) newMirrorSlotIds.push(mid);
          }
        }
      }

      // 7. ancienne période active → desactive
      await tx.period.update({ where: { id: p.id }, data: { state: "desactive" } });
    }

    // 8. journaliser le cycle
    const payload: CycleEventData = {
      archivedPeriodIds,
      newPeriodIds,
      newRecurringSlotIds,
      newMirrorSlotIds,
      oldDeactivatedPeriodIds: actives.map((p) => p.id),
    };
    await tx.cycleEvent.create({
      data: { serviceId, data: payload as unknown as Prisma.InputJsonValue },
    });

    return {
      created: newPeriodIds.length,
      slotsCreated: newRecurringSlotIds.length,
    };
  });
}

// =====================================================================================
// UNDO — retour à l'exercice précédent
// =====================================================================================

export async function undoCycle(serviceId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ev = await tx.cycleEvent.findFirst({
      where: { serviceId },
      orderBy: { id: "desc" },
    });
    if (!ev) return; // no-op

    const data = ev.data as unknown as CycleEventData;
    const newMirrorSlotIds = data.newMirrorSlotIds ?? [];
    const newRecurringSlotIds = data.newRecurringSlotIds ?? [];
    const newPeriodIds = data.newPeriodIds ?? [];
    const oldDeactivatedPeriodIds = data.oldDeactivatedPeriodIds ?? [];
    const archivedPeriodIds = data.archivedPeriodIds ?? [];

    // 1. miroirs uniques : bookings unique puis slots
    if (newMirrorSlotIds.length > 0) {
      await tx.booking.deleteMany({
        where: { slotId: { in: newMirrorSlotIds }, bookingType: "unique" },
      });
      await tx.slot.deleteMany({ where: { id: { in: newMirrorSlotIds } } });
    }

    // 2. récurrents : bookings recurring puis slots
    if (newRecurringSlotIds.length > 0) {
      await tx.booking.deleteMany({
        where: { slotId: { in: newRecurringSlotIds }, bookingType: "recurring" },
      });
      await tx.slot.deleteMany({ where: { id: { in: newRecurringSlotIds } } });
    }

    // 3. périodes : bookings recurring, fériés, puis périodes
    if (newPeriodIds.length > 0) {
      await tx.booking.deleteMany({
        where: { periodId: { in: newPeriodIds }, bookingType: "recurring" },
      });
      await tx.periodHoliday.deleteMany({ where: { periodId: { in: newPeriodIds } } });
      await tx.period.deleteMany({ where: { id: { in: newPeriodIds } } });
    }

    // 4. anciennes désactivées → actif
    if (oldDeactivatedPeriodIds.length > 0) {
      await tx.period.updateMany({
        where: { id: { in: oldDeactivatedPeriodIds } },
        data: { state: "actif" },
      });
    }

    // 5. archivées → desactive
    if (archivedPeriodIds.length > 0) {
      await tx.period.updateMany({
        where: { id: { in: archivedPeriodIds } },
        data: { state: "desactive" },
      });
    }

    // 6. supprimer l'événement
    await tx.cycleEvent.delete({ where: { id: ev.id } });

    // 7. nettoyer les exercices orphelins (sans période rattachée)
    const referenced = await tx.period.findMany({
      where: { exerciceId: { not: null } },
      select: { exerciceId: true },
      distinct: ["exerciceId"],
    });
    const keep = referenced.map((r) => r.exerciceId).filter((x): x is number => x !== null);
    await tx.exercice.deleteMany({
      where: keep.length > 0 ? { id: { notIn: keep } } : {},
    });
  });
}

// =====================================================================================
// UNDO_INFO
// =====================================================================================

export async function undoCycleInfo(serviceId: string): Promise<UndoInfo> {
  const ev = await prisma.cycleEvent.findFirst({
    where: { serviceId },
    orderBy: { id: "desc" },
  });
  if (!ev) return { hasUndo: false, createdAt: null, bookingsCount: 0 };

  const data = ev.data as unknown as CycleEventData;
  const newPeriodIds = data.newPeriodIds ?? [];
  const allSlotIds = [...(data.newRecurringSlotIds ?? []), ...(data.newMirrorSlotIds ?? [])];

  let count = 0;
  if (newPeriodIds.length > 0) {
    count += await prisma.booking.count({
      where: { periodId: { in: newPeriodIds }, bookingType: "recurring" },
    });
  }
  if (allSlotIds.length > 0) {
    count += await prisma.booking.count({ where: { slotId: { in: allSlotIds } } });
  }

  return { hasUndo: true, createdAt: ev.createdAt.toISOString(), bookingsCount: count };
}

// =====================================================================================
// Données du pane exercice
// =====================================================================================

export async function setShowPreviousExercices(serviceId: string, value: boolean): Promise<void> {
  await prisma.service.update({
    where: { id: serviceId },
    data: { showPreviousExercices: value },
  });
}

export async function getExercicePaneData(serviceId: string): Promise<ExercicePaneData> {
  const [actives, svc] = await Promise.all([
    prisma.period.findMany({
      where: { serviceId, state: "actif" },
      select: { dateStart: true, dateEnd: true },
    }),
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { showPreviousExercices: true },
    }),
  ]);

  const starts = actives
    .map((p) => fmtDateUtc(p.dateStart))
    .filter((d): d is string => d !== null)
    .sort();
  const ends = actives
    .map((p) => fmtDateUtc(p.dateEnd))
    .filter((d): d is string => d !== null)
    .sort();

  let currentName = "—";
  let currentRange: { start: string; end: string } | null = null;
  if (starts.length > 0) {
    const startYmd = starts[0];
    const endYmd = ends.length > 0 ? ends[ends.length - 1] : startYmd;
    const sy = Number.parseInt(startYmd.slice(0, 4), 10);
    const ey = Number.parseInt(endYmd.slice(0, 4), 10);
    currentName = exerciceLabel(sy, ey);
    currentRange = { start: startYmd, end: endYmd };
  }

  let nextName: string;
  if (currentRange) {
    const sy = Number.parseInt(currentRange.start.slice(0, 4), 10) + 1;
    const ey = Number.parseInt(currentRange.end.slice(0, 4), 10) + 1;
    nextName = exerciceLabel(sy, ey);
  } else {
    nextName = String(new Date().getUTCFullYear() + 1);
  }

  const undo = await undoCycleInfo(serviceId);

  return {
    currentName,
    nextName,
    currentRange,
    hasActivePeriods: actives.length > 0,
    showPreviousExercices: svc?.showPreviousExercices ?? false,
    undo,
  };
}
