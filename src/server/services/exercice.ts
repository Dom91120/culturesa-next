import { randomUUID } from "node:crypto";
import type { DayOfWeek, Prisma } from "@/generated/prisma/client";
import { holidaysInRange } from "@/lib/french-holidays";
import { type DayKey, mirrorDates } from "@/lib/mirror-dates";
import { schoolYearLabel } from "@/lib/school-year";
import { prisma } from "@/server/db";

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
  // Exercice créé par la bascule (par service) → supprimé tel quel à l'annulation.
  newExerciceId: number | null;
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

// Jours fériés : implémentation partagée dans lib/french-holidays (source unique
// serveur + grilles agenda).

// =====================================================================================
// Helpers — exercice (label) + activeDays + capacités
// =====================================================================================

/** Libellé d'exercice selon le type : civile → année « 2026 » ; scolaire → « 2025-2026 ». */
function exerciceLabel(type: "civile" | "scolaire", startYmd: string): string {
  return type === "civile" ? startYmd.slice(0, 4) : schoolYearLabel(startYmd);
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

/**
 * Génère les miroirs uniques (« u_<slotId>_<date> ») d'un créneau récurrent cloné sur
 * [rangeStart, rangeEnd] : dates de `src.slotDay` (jour actif), hors fériés si
 * !openOnHolidays, filtre semaines A/B — via le noyau partagé `mirrorDates`
 * (lib/mirror-dates), commun à la sauvegarde de créneau (slots.ts). Capacité miroir =
 * capacité unique du créneau. Renvoie les ids créés.
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
    serviceCapacity: number;
  },
): Promise<string[]> {
  const {
    serviceId,
    slotId,
    periodId,
    src,
    rangeStart,
    rangeEnd,
    activeDays,
    openOnHolidays,
    serviceCapacity,
  } = params;
  // Slot mono-jour sans jour → aucun miroir. Capacité vide : repli sur la capacité du
  // service, comme partout ailleurs (agenda, réservation, copie A/B) — sauter la
  // génération laissait les créneaux clonés « Clôturés » côté usager.
  if (src.slotDay == null) return [];
  const cap = src.capacity ?? serviceCapacity;

  const holidaySet = new Set<string>();
  if (!openOnHolidays) {
    for (const h of holidaysInRange(rangeStart, rangeEnd)) holidaySet.add(h.date);
  }

  const dates = mirrorDates({
    startDate: rangeStart,
    endDate: rangeEnd,
    slotDay: src.slotDay as DayKey,
    activeDays: activeDays.map((n) => ISO_KEY[n] as DayKey),
    allowedWeeks: src.weeks === "A" || src.weeks === "B" ? [src.weeks] : ["A", "B"],
    holidaySet,
    openOnHolidays,
  });

  // Accumulation puis UN SEUL createMany : un INSERT par occurrence faisait dépasser
  // le timeout de transaction Prisma (5 s par défaut) dès quelques créneaux × périodes.
  const created: string[] = [];
  const rows: Prisma.SlotCreateManyInput[] = [];
  for (const dateStr of dates) {
    const mid = `u_${slotId}_${dateStr}`;
    created.push(mid);
    rows.push({
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
    });
  }

  if (rows.length > 0) await tx.slot.createMany({ data: rows });
  return created;
}

// =====================================================================================
// CYCLE — création du prochain exercice
// =====================================================================================

export async function cycleService(serviceId: string, opts: CycleOptions): Promise<CycleResult> {
  const { recreatePeriods, recreateSlots } = opts;
  // Legacy (api/periods.php) : si « Recréer les périodes » est décoché, la bascule ne
  // fait rien (no-op). `recreateSlots` ne gate, lui, que le clonage des créneaux.
  if (!recreatePeriods) return { created: 0, slotsCreated: 0 };

  return prisma.$transaction(
    async (tx) => {
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

      // 5. Nouvel exercice PAR SERVICE : on reconduit l'exercice courant en copiant son
      // type et en décalant ses dates d'un an (repli sur les dates des périodes décalées).
      const currentExoId = actives.find((p) => p.exerciceId != null)?.exerciceId ?? null;
      const currentExo = currentExoId
        ? await tx.exercice.findUnique({
            where: { id: currentExoId },
            select: { type: true, dateStart: true, dateEnd: true },
          })
        : null;
      const shiftedStarts = actives
        .map((p) => shiftDateOneYear(fmtDateUtc(p.dateStart)))
        .filter((d): d is string => d !== null)
        .sort();
      const shiftedEnds = actives
        .map((p) => shiftDateOneYear(fmtDateUtc(p.dateEnd)))
        .filter((d): d is string => d !== null)
        .sort();
      const exoStart =
        shiftDateOneYear(fmtDateUtc(currentExo?.dateStart ?? null)) ??
        shiftedStarts[0] ??
        `${new Date().getUTCFullYear() + 1}-09-01`;
      const exoEnd =
        shiftDateOneYear(fmtDateUtc(currentExo?.dateEnd ?? null)) ??
        shiftedEnds[shiftedEnds.length - 1] ??
        null;
      const exoType = currentExo?.type ?? "scolaire";
      const newExo = await tx.exercice.create({
        data: {
          serviceId,
          label: exerciceLabel(exoType, exoStart),
          type: exoType,
          dateStart: dateFromYmd(exoStart),
          dateEnd: exoEnd ? dateFromYmd(exoEnd) : null,
        },
        select: { id: true },
      });
      const exId = newExo.id;

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

        // fériés de la nouvelle période (un seul createMany — cf. generateMirrorSlots)
        if (ns && ne) {
          const holidayRows = holidaysInRange(ns, ne).map((h) => ({
            periodId: newPeriod.id,
            date: dateFromYmd(h.date),
            label: h.label,
          }));
          if (holidayRows.length > 0) await tx.periodHoliday.createMany({ data: holidayRows });
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
                serviceCapacity: service.capacity,
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
        newExerciceId: exId,
      };
      await tx.cycleEvent.create({
        data: { serviceId, data: payload as unknown as Prisma.InputJsonValue },
      });

      return {
        created: newPeriodIds.length,
        slotsCreated: newRecurringSlotIds.length,
      };
      // Timeout élargi : la bascule reste l'opération la plus lourde de l'app
      // (périodes × créneaux × occurrences) — le défaut Prisma (5 s) est trop court.
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

// =====================================================================================
// UNDO — retour à l'exercice précédent
// =====================================================================================

export async function undoCycle(serviceId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
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

      // 7. supprimer UNIQUEMENT l'exercice créé par cette bascule (devenu sans période).
      // (On ne balaye plus tous les orphelins : un exercice vide créé à la main par un
      // gestionnaire doit être préservé.)
      const newExerciceId = data.newExerciceId ?? null;
      if (newExerciceId != null) {
        const exo = await tx.exercice.findUnique({
          where: { id: newExerciceId },
          select: { _count: { select: { periods: true } } },
        });
        if (exo && exo._count.periods === 0) {
          await tx.exercice.delete({ where: { id: newExerciceId } });
        }
      }
      // Timeout élargi : suppressions en masse (miroirs + réservations d'un exercice entier).
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
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
  const [exercices, activeCount, svc] = await Promise.all([
    prisma.exercice.findMany({
      where: { serviceId },
      select: { label: true, type: true, dateStart: true, dateEnd: true },
    }),
    prisma.period.count({ where: { serviceId, state: "actif" } }),
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { showPreviousExercices: true },
    }),
  ]);

  // Exercice courant = le plus récent (date de début la plus tardive, nulls en dernier).
  const sorted = exercices.slice().sort((a, b) => {
    const as = a.dateStart?.getTime();
    const bs = b.dateStart?.getTime();
    if (as != null && bs != null) return bs - as;
    if (as != null) return -1;
    if (bs != null) return 1;
    return b.label.localeCompare(a.label);
  });
  const current = sorted[0] ?? null;

  const currentName = current?.label ?? "—";
  const startYmd = fmtDateUtc(current?.dateStart ?? null);
  const endYmd = fmtDateUtc(current?.dateEnd ?? null);
  const currentRange = startYmd && endYmd ? { start: startYmd, end: endYmd } : null;

  let nextName: string;
  if (current && startYmd) {
    // Exercice suivant = dates de l'exercice courant décalées d'un an (libellé selon le type).
    const nextStart = shiftDateOneYear(startYmd) ?? startYmd;
    nextName = exerciceLabel(current.type, nextStart);
  } else if (current) {
    nextName = `${current.label} (suivant)`;
  } else {
    const ssy = new Date().getUTCFullYear() + 1;
    nextName = `${ssy}-${ssy + 1}`;
  }

  const undo = await undoCycleInfo(serviceId);

  return {
    currentName,
    nextName,
    currentRange,
    hasActivePeriods: activeCount > 0,
    showPreviousExercices: svc?.showPreviousExercices ?? false,
    undo,
  };
}
