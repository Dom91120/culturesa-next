import type { DayOfWeek, Prisma } from "@/generated/prisma/client";
import { parseWeeks } from "@/lib/agenda-core";
import { type DayKey, mirrorDates } from "@/lib/mirror-dates";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import { schoolYearLabel } from "@/lib/school-year";
import { prisma } from "@/server/db";
import { getSchoolZone, loadSchoolHolidayRanges } from "@/server/services/holidays";
import { DEFAULT_OPENING, EXERCICE_OPENING_SELECT } from "@/server/services/opening";
import { refreshPeriodHolidays } from "@/server/services/periods";
import { buildMirrorRows, loadMirrorContext, newRecurId } from "@/server/services/slots";

// =====================================================================================
// Types
// =====================================================================================

/** Erreur métier de bascule d'exercice (message destiné à l'admin) — distinguée des
 *  erreurs techniques : l'action ne relaie que ces messages, les autres sont loggées
 *  et génériques (audit 2026-07-19, cf. B2). */
export class CycleError extends Error {}

type CycleOptions = {
  recreatePeriods: boolean;
  recreateSlots: boolean;
  // Reconduire aussi les LOTS de créneaux multi-ponctuels (batchId) : mêmes jour de
  // semaine / horaires / capacité / jauge / parité / demandeurs, aux dates régénérées
  // dans la nouvelle période (même filtrage qu'à la création multiple).
  recreateMultiSlots: boolean;
};

type CycleResult = {
  created: number;
  slotsCreated: number;
  multiSlotsCreated: number;
};

type UndoInfo = {
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
  newPeriodIds: number[];
  newRecurringSlotIds: string[];
  newMirrorSlotIds: string[];
  // Ponctuels des lots « multi » reconduits — absent sur les événements antérieurs
  // à l'option (2026-07-25).
  newMultiSlotIds?: string[];
  // Exercice créé par la bascule (par service) → supprimé tel quel à l'annulation.
  newExerciceId: number | null;
  // Exercice qui portait « Affiché aux utilisateurs » avant la bascule (le flag est
  // transféré au nouvel exercice) — restauré à l'annulation. Absent/null : aucun.
  visibleFromExerciceId?: number | null;
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
function shiftDateOneYear(date: string | null): string | null {
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
 * Comparateur UNIQUE « exercice le plus récent d'abord » : date de début la plus
 * tardive, nulls en dernier, départage par id décroissant. Partagé par la bascule,
 * `currentExerciceIdForService` et le pane exercice — trois copies divergeaient
 * (l'une sans départage par id) et pouvaient désigner un « courant » différent.
 */
function byMostRecentExercice(
  a: { id: number; dateStart: Date | null },
  b: { id: number; dateStart: Date | null },
): number {
  const as = a.dateStart?.getTime();
  const bs = b.dateStart?.getTime();
  if (as != null && bs != null) return bs - as || b.id - a.id;
  if (as != null) return -1;
  if (bs != null) return 1;
  return b.id - a.id;
}

type SlotSnapshot = {
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDay: DayOfWeek | null;
  weeks: string | null;
  // « A une jauge » : reconduit à l'identique par la bascule (clone + miroirs).
  jauge: boolean;
  // Demandeurs autorisés (SlotDemandeur) : reconduits eux aussi — sans eux, un
  // créneau restreint redevenait « ouvert à tous » après la bascule (audit 2026-07-17).
  demandeurIds: number[];
};

// (La génération des miroirs des créneaux clonés passe par le pipeline UNIQUE de
// slots.ts — loadMirrorContext + buildMirrorRows — depuis l'audit 2026-07-17 : la
// bascule entretenait son propre générateur, avec une source de fériés et des
// conventions de normalisation divergentes.)

// Jour de semaine (getUTCDay 0=dim..6=sam) → clé de jour (les @db.Date sont à minuit UTC).
const DOW_TO_DAY: DayKey[] = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

/** Représentant d'un LOT multi-ponctuel (batchId) : tous les créneaux d'un lot partagent
 *  jour de semaine, horaires, capacité, jauge, parité et demandeurs — cf. addUniqueSlotBatch. */
type MultiLotSnapshot = {
  startTime: string;
  endTime: string;
  capacity: number | null;
  jauge: boolean;
  // Parité du lot ("A" | "B" | "" = toutes) — même sens que Slot.weeks.
  weeks: string;
  slotDay: DayKey;
  demandeurIds: number[];
};

// =====================================================================================
// CYCLE — création du prochain exercice
// =====================================================================================

export async function cycleService(serviceId: string, opts: CycleOptions): Promise<CycleResult> {
  const { recreatePeriods, recreateSlots, recreateMultiSlots } = opts;
  // Legacy (api/periods.php) : si « Recréer les périodes » est décoché, la bascule ne
  // fait rien (no-op). `recreateSlots`/`recreateMultiSlots` ne gatent, eux, que le
  // clonage des créneaux (récurrents / lots multi-ponctuels).
  if (!recreatePeriods) return { created: 0, slotsCreated: 0, multiSlotsCreated: 0 };

  return prisma.$transaction(
    async (tx) => {
      const service = await tx.service.findUnique({ where: { id: serviceId } });
      if (!service) throw new CycleError("Service introuvable.");

      // 1. exercice COURANT = le plus récent du service (date de début la plus tardive,
      // nulls en dernier, puis id). C'est lui qu'on reconduit : depuis la simplification
      // des états, les périodes des exercices passés restent « actif » — l'état ne
      // distingue plus l'exercice courant, seul le rattachement exerciceId le fait.
      const exercicesRows = await tx.exercice.findMany({
        where: { serviceId },
        select: { id: true, dateStart: true, visibleToUsers: true },
      });
      const currentExoRow = exercicesRows.slice().sort(byMostRecentExercice)[0] ?? null;

      // Périodes à reconduire : celles (actives) de l'exercice courant — repli legacy
      // sans exercice : toutes les périodes actives du service.
      const actives = await tx.period.findMany({
        where: currentExoRow ? { serviceId, exerciceId: currentExoRow.id } : { serviceId },
        orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      });
      if (actives.length === 0) {
        throw new CycleError("Aucune période active à reconduire.");
      }

      // 2. snapshot des créneaux récurrents actifs par période active — UNE requête
      // pour toutes les périodes (le findMany PAR période était un N+1, audit perf).
      const snapshotRows = await tx.slot.findMany({
        where: { serviceId, periodId: { in: actives.map((p) => p.id) }, slotType: "recurring" },
        include: { demandeurs: { select: { demandeurId: true } } },
      });
      const slotsByPeriod = new Map<number, SlotSnapshot[]>();
      for (const s of snapshotRows) {
        if (s.periodId == null) continue;
        const list = slotsByPeriod.get(s.periodId) ?? [];
        list.push({
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity,
          slotDay: s.slotDay,
          weeks: s.weeks,
          jauge: s.jauge,
          demandeurIds: s.demandeurs.map((d) => d.demandeurId),
        });
        slotsByPeriod.set(s.periodId, list);
      }

      // 2 bis. snapshot des LOTS multi-ponctuels par période active : un représentant
      // par batchId (jour/horaires/capacité/jauge/parité/demandeurs partagés par le lot,
      // cf. copyPonctuelWeek). Les ponctuels ISOLÉS (batchId null) ne sont pas reconduits.
      const multiRows = recreateMultiSlots
        ? await tx.slot.findMany({
            where: {
              serviceId,
              periodId: { in: actives.map((p) => p.id) },
              slotType: "unique",
              batchId: { not: null },
              parentSlotId: null,
            },
            include: { demandeurs: { select: { demandeurId: true } } },
            orderBy: { slotDate: "asc" },
          })
        : [];
      const lotsByPeriod = new Map<number, MultiLotSnapshot[]>();
      const seenBatchIds = new Set<string>();
      for (const s of multiRows) {
        if (!s.batchId || !s.slotDate || s.periodId == null || seenBatchIds.has(s.batchId)) {
          continue;
        }
        seenBatchIds.add(s.batchId);
        const list = lotsByPeriod.get(s.periodId) ?? [];
        list.push({
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity,
          jauge: s.jauge,
          weeks: s.weeks ?? "",
          slotDay: DOW_TO_DAY[s.slotDate.getUTCDay()],
          demandeurIds: s.demandeurs.map((d) => d.demandeurId),
        });
        lotsByPeriod.set(s.periodId, list);
      }

      // (Les exercices antérieurs ne sont plus archivés : la notion d'état a été
      // supprimée. Le périmètre des vues se fait par exercice, pas par état — les
      // exercices passés restent consultables via le sélecteur d'exercice.)

      // 5. Nouvel exercice PAR SERVICE : on reconduit l'exercice courant en copiant son
      // type et en décalant ses dates d'un an (repli sur les dates des périodes décalées).
      const currentExo = currentExoRow
        ? await tx.exercice.findUnique({
            where: { id: currentExoRow.id },
            select: {
              type: true,
              dateStart: true,
              dateEnd: true,
              maxReservations: true,
              maxReservationsPeriod: true,
              // bookingDelay est déjà dans EXERCICE_OPENING_SELECT (porté par l'exercice).
              ...EXERCICE_OPENING_SELECT,
            },
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
      // Réglages d'ouverture REPRIS de l'exercice reconduit (défauts applicatifs
      // si le service n'avait aucun exercice — cas théorique, la bascule exige des
      // périodes actives donc un exercice).
      const opening = currentExo
        ? {
            morningStart: currentExo.morningStart,
            morningEnd: currentExo.morningEnd,
            afternoonStart: currentExo.afternoonStart,
            afternoonEnd: currentExo.afternoonEnd,
            activeDays: currentExo.activeDays,
            openOnHolidays: currentExo.openOnHolidays,
            openOnSchoolHolidays: currentExo.openOnSchoolHolidays,
            // Délai limite de réservation REPRIS de l'exercice reconduit.
            bookingDelay: currentExo.bookingDelay,
          }
        : DEFAULT_OPENING;
      const newExo = await tx.exercice.create({
        data: {
          serviceId,
          label: exerciceLabel(exoType, exoStart),
          type: exoType,
          dateStart: dateFromYmd(exoStart),
          dateEnd: exoEnd ? dateFromYmd(exoEnd) : null,
          ...opening,
          // Maximums de réservation REPRIS de l'exercice reconduit (défauts du
          // schéma sinon).
          ...(currentExo
            ? {
                maxReservations: currentExo.maxReservations,
                maxReservationsPeriod: currentExo.maxReservationsPeriod,
              }
            : {}),
        },
        select: { id: true },
      });
      const exId = newExo.id;

      // Vacances scolaires pour la reconduction des lots multi-ponctuels : comme à la
      // création multiple (cf. copyPonctuelWeek), les dates en vacances sont exclues
      // sauf si le nouvel exercice ouvre pendant les vacances scolaires.
      const openOnSchool = opening.openOnSchoolHolidays;
      const schoolRanges =
        recreateMultiSlots && !openOnSchool
          ? await loadSchoolHolidayRanges(tx, await getSchoolZone())
          : [];

      // 6. recopie des périodes — jours actifs / fériés du nouvel exercice (résolus
      // par loadMirrorContext depuis l'exercice créé, cf. plus bas).
      const newPeriodIds: number[] = [];
      const newRecurringSlotIds: string[] = [];
      const newMirrorSlotIds: string[] = [];
      const newMultiSlotIds: string[] = [];

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
          },
        });
        newPeriodIds.push(newPeriod.id);

        // Fériés de la nouvelle période : source unique refreshPeriodHolidays
        // (la bascule recopiait la logique en inline — audit 2026-07-17).
        if (ns && ne) await refreshPeriodHolidays(newPeriod.id, tx);

        // Contexte de génération des miroirs UNIQUE (même pipeline que les
        // mutations de créneau, slots.ts) — chargé APRÈS le remplissage des fériés.
        // Sert aussi à régénérer les dates des lots multi-ponctuels reconduits.
        const mirrorCtx =
          (recreateSlots || recreateMultiSlots) &&
          ns &&
          ne &&
          newPeriod.dateStart &&
          newPeriod.dateEnd
            ? await loadMirrorContext(tx, {
                id: newPeriod.id,
                dateStart: newPeriod.dateStart,
                dateEnd: newPeriod.dateEnd,
                exerciceId: exId,
              })
            : null;

        // Créneaux clonés : ACCUMULÉS puis UN createMany par table — créneaux, puis
        // restrictions de demandeurs, puis miroirs (les parents doivent exister
        // avant leurs miroirs). Les inserts unitaires en boucle rendaient la
        // bascule inutilement longue sous son timeout (audit perf 2026-07-17).
        if (recreateSlots) {
          const snapshot = slotsByPeriod.get(p.id) ?? [];
          const slotRows: Prisma.SlotCreateManyInput[] = [];
          const demandeurRows: { slotId: string; demandeurId: number }[] = [];
          const mirrorRows: Prisma.SlotCreateManyInput[] = [];
          for (const s of snapshot) {
            const newSlotId = newRecurId();
            slotRows.push({
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
              jauge: s.jauge,
            });
            newRecurringSlotIds.push(newSlotId);
            // Restrictions de demandeurs reconduites avec le créneau (les miroirs
            // suivent leur parent, cf. createUniqueBookingInTx — pas de lignes propres).
            for (const demandeurId of s.demandeurIds) {
              demandeurRows.push({ slotId: newSlotId, demandeurId });
            }
            if (mirrorCtx) {
              const rows = buildMirrorRows({
                serviceId,
                periodId: newPeriod.id,
                slot: {
                  id: newSlotId,
                  startTime: s.startTime,
                  endTime: s.endTime,
                  weeks: s.weeks,
                  slotDay: s.slotDay,
                  capacity: s.capacity,
                  jauge: s.jauge,
                },
                ctx: mirrorCtx,
                serviceCapacity: service.capacity,
              });
              mirrorRows.push(...rows);
              for (const r of rows) newMirrorSlotIds.push(r.id as string);
            }
          }
          if (slotRows.length > 0) await tx.slot.createMany({ data: slotRows });
          if (demandeurRows.length > 0) await tx.slotDemandeur.createMany({ data: demandeurRows });
          if (mirrorRows.length > 0) await tx.slot.createMany({ data: mirrorRows });
        }

        // Lots multi-ponctuels reconduits : dates régénérées dans la nouvelle période
        // (même jour de semaine et parité que le lot source, filtrées comme à la
        // création multiple — jours actifs, fériés, vacances scolaires du NOUVEL
        // exercice). Un lot dont le jour n'est plus ouvert ne produit rien.
        if (recreateMultiSlots && mirrorCtx) {
          const lots = lotsByPeriod.get(p.id) ?? [];
          const multiSlotRows: Prisma.SlotCreateManyInput[] = [];
          const multiDemandeurRows: { slotId: string; demandeurId: number }[] = [];
          for (const lot of lots) {
            const dates = mirrorDates({
              startDate: mirrorCtx.startDate,
              endDate: mirrorCtx.endDate,
              slotDay: lot.slotDay,
              activeDays: mirrorCtx.activeDays,
              allowedWeeks: parseWeeks(lot.weeks || null),
              holidaySet: mirrorCtx.holidaySet,
              openOnHolidays: mirrorCtx.openOnHolidays,
            }).filter((d) => openOnSchool || !isInSchoolHolidayRange(d, schoolRanges));
            if (dates.length === 0) continue;
            // batchId/parité seulement si plusieurs dates (cf. addUniqueSlotBatch).
            const isBatch = dates.length > 1;
            const newBatchId = isBatch ? crypto.randomUUID() : null;
            const weeks = isBatch ? lot.weeks : "";
            for (const d of dates) {
              const newSlotId = newRecurId();
              multiSlotRows.push({
                id: newSlotId,
                serviceId,
                slotType: "unique",
                startTime: lot.startTime,
                endTime: lot.endTime,
                slotDate: dateFromYmd(d),
                capacity: lot.capacity,
                periodId: newPeriod.id,
                jauge: lot.jauge,
                batchId: newBatchId,
                weeks,
              });
              newMultiSlotIds.push(newSlotId);
              for (const demandeurId of lot.demandeurIds) {
                multiDemandeurRows.push({ slotId: newSlotId, demandeurId });
              }
            }
          }
          if (multiSlotRows.length > 0) await tx.slot.createMany({ data: multiSlotRows });
          if (multiDemandeurRows.length > 0) {
            await tx.slotDemandeur.createMany({ data: multiDemandeurRows });
          }
        }

        // (Les périodes reconduites RESTENT actives : « exercice précédent » se déduit
        // de leur exerciceId, la visibilité usager de la case « Affiché aux utilisateurs ».)
      }

      // 7. transfert de « Affiché aux utilisateurs » : si l'exercice reconduit était
      // celui affiché aux usagers, le nouvel exercice prend le relais (unicité par
      // service) — les usagers basculent sur le nouvel exercice comme avant.
      const visibleFromExerciceId = currentExoRow?.visibleToUsers ? currentExoRow.id : null;
      if (visibleFromExerciceId != null) {
        await tx.exercice.update({
          where: { id: visibleFromExerciceId },
          data: { visibleToUsers: false },
        });
        await tx.exercice.update({ where: { id: exId }, data: { visibleToUsers: true } });
      }

      // 8. journaliser le cycle
      const payload: CycleEventData = {
        newPeriodIds,
        newRecurringSlotIds,
        newMirrorSlotIds,
        newMultiSlotIds,
        newExerciceId: exId,
        visibleFromExerciceId,
      };
      await tx.cycleEvent.create({
        data: { serviceId, data: payload as unknown as Prisma.InputJsonValue },
      });

      return {
        created: newPeriodIds.length,
        slotsCreated: newRecurringSlotIds.length,
        multiSlotsCreated: newMultiSlotIds.length,
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
      const newMultiSlotIds = data.newMultiSlotIds ?? [];
      const newRecurringSlotIds = data.newRecurringSlotIds ?? [];
      const newPeriodIds = data.newPeriodIds ?? [];

      // 1. miroirs uniques + ponctuels des lots multi reconduits : bookings unique
      // puis slots (mêmes suppressions, populations disjointes).
      const uniqueSlotIds = [...newMirrorSlotIds, ...newMultiSlotIds];
      if (uniqueSlotIds.length > 0) {
        await tx.booking.deleteMany({
          where: { slotId: { in: uniqueSlotIds }, bookingType: "unique" },
        });
        await tx.slot.deleteMany({ where: { id: { in: uniqueSlotIds } } });
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

      // (Plus de restauration d'état : la notion d'archivage de période a été
      // supprimée. Les bascules ne modifient plus l'état des exercices antérieurs.)

      // 5 bis. restaurer « Affiché aux utilisateurs » sur l'exercice qui le portait
      // avant la bascule (le flag avait été transféré au nouvel exercice).
      const visibleFromExerciceId = data.visibleFromExerciceId ?? null;
      if (visibleFromExerciceId != null) {
        await tx.exercice.updateMany({
          where: { serviceId, visibleToUsers: true },
          data: { visibleToUsers: false },
        });
        await tx.exercice.update({
          where: { id: visibleFromExerciceId },
          data: { visibleToUsers: true },
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

async function undoCycleInfo(serviceId: string): Promise<UndoInfo> {
  const ev = await prisma.cycleEvent.findFirst({
    where: { serviceId },
    orderBy: { id: "desc" },
  });
  if (!ev) return { hasUndo: false, createdAt: null, bookingsCount: 0 };

  const data = ev.data as unknown as CycleEventData;
  const newPeriodIds = data.newPeriodIds ?? [];
  const allSlotIds = [
    ...(data.newRecurringSlotIds ?? []),
    ...(data.newMirrorSlotIds ?? []),
    ...(data.newMultiSlotIds ?? []),
  ];

  // Compte ce que l'undo supprimera RÉELLEMENT : les créneaux créés après la bascule
  // (ponctuel ajouté à l'agenda, nouveau récurrent, miroirs régénérés) ne sont pas dans
  // le CycleEvent mais partent quand même par cascade Period → Slot → Booking — on
  // passe donc par le rattachement aux nouvelles périodes, pas par les IDs figés seuls.
  // Enfants d'occurrence exclus (parentBookingId) : une réservation = une ligne.
  const or: Prisma.BookingWhereInput[] = [];
  if (newPeriodIds.length > 0) {
    or.push({ periodId: { in: newPeriodIds } });
    or.push({ slot: { periodId: { in: newPeriodIds } } });
  }
  if (allSlotIds.length > 0) {
    or.push({ slotId: { in: allSlotIds } });
  }
  const count =
    or.length > 0 ? await prisma.booking.count({ where: { parentBookingId: null, OR: or } }) : 0;

  return { hasUndo: true, createdAt: ev.createdAt.toISOString(), bookingsCount: count };
}

// =====================================================================================
// Données du pane exercice
// =====================================================================================

/**
 * Id de l'exercice COURANT d'un service = le plus récent (date de début la plus
 * tardive, nulls en dernier, puis id décroissant). Null si le service n'a aucun
 * exercice. Sert aux vues admin (agenda, stats, éditions) : depuis la
 * simplification des états, les périodes des exercices passés restent « actif »
 * — le périmètre par défaut est donc l'exercice courant, pas l'état.
 */
export async function currentExerciceIdForService(serviceId: string): Promise<number | null> {
  const rows = await prisma.exercice.findMany({
    where: { serviceId },
    select: { id: true, dateStart: true },
  });
  const current = rows.slice().sort(byMostRecentExercice)[0];
  return current?.id ?? null;
}

/**
 * Clause `where` des périodes ÉLIGIBLES d'un service (SOURCE UNIQUE, partagée par
 * agenda / stats / éditions) : périodes de l'exercice COURANT, ou de TOUS les
 * exercices si le service « affiche les exercices précédents ». Évite que ce filtre —
 * jusqu'ici copié mot pour mot dans les 3 écrans — diverge.
 */
export function eligiblePeriodsWhere(
  serviceId: string,
  showPreviousExercices: boolean,
  currentExoId: number | null,
): Prisma.PeriodWhereInput {
  return {
    serviceId,
    ...(!showPreviousExercices && currentExoId != null ? { exerciceId: currentExoId } : {}),
  };
}

/**
 * À partir de périodes portant leur `exercice`, renvoie les exercices DISTINCTS triés
 * par libellé + l'exercice sélectionné (param d'URL `spId`, sinon le plus récent = le
 * dernier). Générique sur la forme de l'exercice (chaque écran sélectionne ses champs).
 * Source unique de la dédup + sélection, partagée par stats et éditions.
 */
export function pickEligibleExercices<E extends { id: number; label: string }>(
  periods: { exercice: E | null }[],
  spId: number | undefined,
): { exercices: E[]; selected: E | null } {
  const map = new Map<number, E>();
  for (const p of periods)
    if (p.exercice && !map.has(p.exercice.id)) map.set(p.exercice.id, p.exercice);
  const exercices = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  const selected =
    (spId != null && exercices.find((e) => e.id === spId)) || exercices.at(-1) || null;
  return { exercices, selected };
}

export async function setShowPreviousExercices(serviceId: string, value: boolean): Promise<void> {
  await prisma.service.update({
    where: { id: serviceId },
    data: { showPreviousExercices: value },
  });
}

export async function getExercicePaneData(serviceId: string): Promise<ExercicePaneData> {
  const [exercices, svc] = await Promise.all([
    prisma.exercice.findMany({
      where: { serviceId },
      select: { id: true, label: true, type: true, dateStart: true, dateEnd: true },
    }),
    prisma.service.findUnique({
      where: { id: serviceId },
      select: { showPreviousExercices: true },
    }),
  ]);

  // Exercice courant = le plus récent (comparateur unique — même départage que la
  // bascule et currentExerciceIdForService, cf. byMostRecentExercice).
  const current = exercices.slice().sort(byMostRecentExercice)[0] ?? null;

  // La bascule reconduit les périodes de l'exercice COURANT (portée par exercice
  // depuis la suppression de la notion d'état actif/archivé).
  const activeCount = await prisma.period.count({
    where: current ? { serviceId, exerciceId: current.id } : { serviceId },
  });

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
