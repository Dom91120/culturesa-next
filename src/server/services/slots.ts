import { Prisma } from "@/generated/prisma/client";
import { mirrorDates } from "@/lib/mirror-dates";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";
import { openingForExercice } from "@/server/services/opening";
import {
  createSyncRecurringCache,
  type SyncRecurringCache,
  syncChildrenForRecurringSlot,
} from "@/server/services/recurring-children";

/** Refus d'une mutation de créneau (ex. régénération de miroirs bloquée par une
 *  réservation existante). Message destiné à l'admin. */
export class SlotMutationError extends Error {}

// Helpers de l'agenda admin (mode « Création de créneau ») : ajout/copie/déplacement/
// suppression de créneaux + génération de leurs miroirs. L'API « upsert en masse »
// de l'ancien onglet Créneaux (saveRecurringSlots/saveUniqueSlots, getCreneauxData,
// CRUD unitaire) a été supprimée avec l'onglet (audit code mort 2026-06).

// ─── Constants & helpers ───────────────────────────────────────────

// Jours de la semaine : source unique = DAYS (schemas/config), aussi adossée à
// l'enum Zod. type DayKey en dérive (audit duplication D2).
type DayKey = (typeof DAYS)[number];

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

/** Id d'un nouveau créneau récurrent — exporté : la bascule d'exercice clone les
 * créneaux avec la même convention (audit 2026-07-17, littéral dupliqué). */
export function newRecurId(): string {
  return `sl_${crypto.randomUUID().slice(0, 8)}`;
}

/** CSV « lun,mar,… » → DayKey[] (jours reconnus uniquement). */
function activeDayKeys(csv: string): DayKey[] {
  return csv
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is DayKey => DAYS.includes(d as DayKey));
}

/**
 * Valeur `weeks` à PERSISTER, normalisée selon la convention :
 *   - "A" ou "B" → mode A/B, semaine unique ;
 *   - "" → aucune distinction A/B = TOUTES les semaines (services non A/B).
 * Toute autre valeur ("A,B", null, "B,A"…) est ramenée à "" : « A,B » n'est JAMAIS
 * persisté. `parseWeeks("")` renvoie ["A","B"], donc "" tourne bien chaque semaine.
 */
function normalizeWeeks(weeks: string | null | undefined): string {
  const w = (weeks ?? "").trim();
  return w === "A" || w === "B" ? w : "";
}

function mirrorId(slotId: string, dateStr: string): string {
  return `u_${slotId}_${dateStr}`;
}

/** Demandeurs autorisés normalisés (entiers > 0, dédupliqués). Vide = ouvert à tous. */
function normalizeDemandeurIds(demandeurIds: number[] | undefined): number[] {
  return [...new Set((demandeurIds ?? []).filter((d) => Number.isInteger(d) && d > 0))];
}

/** Id de la période du service couvrant une date « YYYY-MM-DD », sinon null. Source
 *  unique du rattachement d'un créneau ponctuel (création ET déplacement) — findFirst,
 *  sans départage si deux périodes se chevauchent (cf. audit orderBy). */
async function periodIdCoveringDate(serviceId: string, slotDate: string): Promise<number | null> {
  const period = await prisma.period.findFirst({
    where: {
      serviceId,
      dateStart: { lte: fromISO(slotDate) },
      dateEnd: { gte: fromISO(slotDate) },
    },
    select: { id: true },
  });
  return period?.id ?? null;
}

// ─── Mirror generation (ported from api/slots.php save_recurring) ───

type WantedMirror = { date: string; cap: number };

// Miroirs attendus d'un créneau récurrent (modèle « un slot = un jour ») : dates de
// `slotDay` sur la période, capacité unique du créneau. Noyau dates partagé avec la
// bascule d'exercice (lib/mirror-dates) — voir `mirrorDates`.
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
  for (const date of mirrorDates({
    startDate,
    endDate,
    slotDay,
    activeDays,
    allowedWeeks: weeks,
    holidaySet,
    openOnHolidays,
  })) {
    wanted.set(date, { date, cap: capacity });
  }
  return wanted;
}

/**
 * Contexte de génération des miroirs d'une période : bornes, ouverture de son
 * exercice (jours actifs / fériés) et fériés lus dans `period_holidays` — SOURCE
 * UNIQUE partagée par les 4 mutations de créneau ET la bascule d'exercice (audit
 * 2026-07-17 : deux pipelines parallèles, l'un lisant la table, l'autre recalculant
 * les fériés en code). À charger APRÈS refreshPeriodHolidays pour une période neuve.
 */
export type MirrorContext = {
  startDate: string;
  endDate: string;
  activeDays: DayKey[];
  openOnHolidays: boolean;
  holidaySet: Set<string>;
};

export async function loadMirrorContext(
  db: Prisma.TransactionClient,
  period: { id: number; dateStart: Date; dateEnd: Date; exerciceId: number | null },
): Promise<MirrorContext> {
  const opening = await openingForExercice(db, period.exerciceId);
  const holidays = await db.periodHoliday.findMany({
    where: { periodId: period.id },
    select: { date: true },
  });
  return {
    startDate: toISO(period.dateStart),
    endDate: toISO(period.dateEnd),
    activeDays: opening ? activeDayKeys(opening.activeDays) : [],
    openOnHolidays: opening?.openOnHolidays ?? false,
    holidaySet: new Set(holidays.map((h) => toISO(h.date))),
  };
}

/**
 * Lignes `slot.createMany` des MIROIRS d'un créneau récurrent : id déterministe
 * `u_<slotId>_<date>`, horaires/jauge hérités du parent, capacité du créneau (repli
 * capacité du service), semaines normalisées (« A,B » jamais persisté → toutes).
 * Un créneau sans jour (slotDay null) ne génère rien.
 */
export function buildMirrorRows(args: {
  serviceId: string;
  periodId: number;
  slot: {
    id: string;
    startTime: string;
    endTime: string;
    weeks: string | null;
    slotDay: string | null;
    capacity: number | null;
    jauge: boolean;
  };
  ctx: MirrorContext;
  serviceCapacity: number;
}): Prisma.SlotCreateManyInput[] {
  const { serviceId, periodId, slot, ctx, serviceCapacity } = args;
  if (!slot.slotDay || !DAYS.includes(slot.slotDay as DayKey)) return [];
  const wanted = computeWantedMirrors({
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    activeDays: ctx.activeDays,
    holidaySet: ctx.holidaySet,
    openOnHolidays: ctx.openOnHolidays,
    weeks: parseWeeks(normalizeWeeks(slot.weeks)),
    slotDay: slot.slotDay as DayKey,
    capacity: slot.capacity ?? serviceCapacity,
  });
  return [...wanted.values()].map((mv) => ({
    id: mirrorId(slot.id, mv.date),
    serviceId,
    slotType: "unique" as const,
    startTime: slot.startTime,
    endTime: slot.endTime,
    slotDate: fromISO(mv.date),
    capacity: mv.cap,
    periodId,
    parentSlotId: slot.id,
    jauge: slot.jauge,
  }));
}

/**
 * Régénère les miroirs des créneaux récurrents d'une période après un changement de
 * dates (période) ou de config d'ouverture (exercice : jours actifs / fériés), DANS le
 * `tx` fourni. Pour chaque créneau récurrent actif de la période :
 *   - recalcule les miroirs attendus (nouvelles bornes / jours actifs / fériés) ;
 *   - REFUSE (SlotMutationError) si un miroir devenu invalide porte une réservation —
 *     l'admin doit d'abord l'annuler (cohérent avec moveRecurringSlot ; sinon perte en
 *     cascade via Booking.slot onDelete: Cascade) ;
 *   - sinon purge les miroirs invalides SANS réservation, crée les manquants, et
 *     resynchronise les enfants des réservations récurrentes (occurrences ajoutées si la
 *     période s'est étendue).
 * À exécuter dans une transaction SÉRIALISABLE (la vérif « réservé » + les mutations
 * doivent être atomiques, comme moveUniqueSlot).
 */
export async function regenerateRecurringMirrorsForPeriodInTx(
  tx: Prisma.TransactionClient,
  serviceId: string,
  periodId: number,
  // Cache partagé de resynchronisation des enfants : à fournir quand on régénère
  // PLUSIEURS périodes dans la même transaction (config d'exercice), pour mutualiser
  // vacances/ouvertures/politiques entre périodes (anti-N+1, audit 2026-07-17).
  syncCache?: SyncRecurringCache,
): Promise<void> {
  const period = await tx.period.findUnique({
    where: { id: periodId },
    select: { dateStart: true, dateEnd: true, exerciceId: true },
  });
  // Période sans dates → aucun miroir attendu (cohérent avec opening.ts « fermé »).
  if (!period?.dateStart || !period?.dateEnd) return;
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    select: { capacity: true },
  });
  const serviceCapacity = service?.capacity ?? 1;
  // Contexte de génération UNIQUE (bornes + ouverture + fériés), cf. loadMirrorContext.
  const ctx = await loadMirrorContext(tx, {
    id: periodId,
    dateStart: period.dateStart,
    dateEnd: period.dateEnd,
    exerciceId: period.exerciceId,
  });

  const recurringSlots = await tx.slot.findMany({
    where: { serviceId, slotType: "recurring", periodId },
    select: {
      id: true,
      slotDay: true,
      weeks: true,
      capacity: true,
      jauge: true,
      startTime: true,
      endTime: true,
    },
  });

  // Un seul cache pour toute la régénération (tous créneaux, tous parents).
  const cache = syncCache ?? createSyncRecurringCache();
  for (const slot of recurringSlots) {
    if (!slot.slotDay) continue;
    // Lignes attendues (pipeline unique buildMirrorRows) → diff avec l'existant.
    const wantedRows = buildMirrorRows({ serviceId, periodId, slot, ctx, serviceCapacity });
    const wantedIds = new Set(wantedRows.map((r) => r.id as string));
    const existing = await tx.slot.findMany({
      where: { parentSlotId: slot.id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((m) => m.id));
    const toDelete = existing.filter((m) => !wantedIds.has(m.id)).map((m) => m.id);
    if (toDelete.length > 0) {
      // Refus si un miroir devenu invalide porte une réservation (enfant d'une récurrente
      // OU ponctuelle) : on ne supprime pas une date réservée en silence.
      const booked = await tx.booking.count({ where: { slotId: { in: toDelete } } });
      if (booked > 0) {
        throw new SlotMutationError(
          "Des réservations existent sur des dates désormais hors période — annulez-les d'abord.",
        );
      }
      await tx.slot.deleteMany({ where: { id: { in: toDelete } } });
    }
    const toCreate = wantedRows.filter((r) => !existingIds.has(r.id as string));
    if (toCreate.length > 0) {
      await tx.slot.createMany({ data: toCreate });
    }
    // Resynchronise les enfants des réservations récurrentes de ce créneau (crée les
    // occurrences des nouvelles dates si la période s'est étendue).
    await syncChildrenForRecurringSlot(tx, slot.id, { cache });
  }
}

// ─── Ajout d'UN créneau depuis l'agenda (mode « Création de créneau ») ──────────
// Ces helpers ajoutent un seul créneau sans toucher aux autres.

/** Ajoute un créneau RÉCURRENT (+ ses miroirs) pour une période/jour donnés. */
export async function addRecurringSlot(
  serviceId: string,
  periodId: number,
  input: {
    startTime: string;
    endTime: string;
    weeks: string;
    dayKey: DayKey;
    capacity: number;
    demandeurIds?: number[];
    // « A une jauge » : mode jauge de l'agenda au moment de la création.
    jauge?: boolean;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({ where: { id: periodId, serviceId } });
  if (!period?.dateStart || !period?.dateEnd) {
    return { ok: false, error: "Période introuvable ou sans dates" };
  }
  // NB : en mode A/B, `weeks` peut être "A", "B" OU "" (toutes les semaines) — le bouton
  // « Semaine A/B » de l'agenda pilote ce choix ; normalizeWeeks ramène toute autre valeur
  // à "". Plus de contrainte « parité obligatoire » (ex-vue Modèle).
  // Contexte de génération UNIQUE (bornes + ouverture de l'exercice + fériés) —
  // période sans exercice = FERMÉ : aucun miroir, cf. opening.ts / loadMirrorContext.
  const ctx = await loadMirrorContext(prisma, {
    id: periodId,
    dateStart: period.dateStart,
    dateEnd: period.dateEnd,
    exerciceId: period.exerciceId,
  });
  const weeks = normalizeWeeks(input.weeks);
  const slId = newRecurId();
  const demandeurIds = normalizeDemandeurIds(input.demandeurIds);
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
          slotDay: input.dayKey,
          capacity: input.capacity,
          jauge: input.jauge ?? false,
        },
      });
      // Demandeurs autorisés posés dans la même transaction : un échec ici annule
      // la création du créneau (sinon créneau ouvert à tous au lieu de restreint).
      if (demandeurIds.length > 0) {
        await tx.slotDemandeur.createMany({
          data: demandeurIds.map((demandeurId) => ({ slotId: slId, demandeurId })),
        });
      }
      // Un seul createMany (pipeline unique buildMirrorRows) : un INSERT par miroir
      // risquait le timeout de transaction Prisma sur une période annuelle.
      const mirrorRows = buildMirrorRows({
        serviceId,
        periodId,
        slot: {
          id: slId,
          startTime: input.startTime,
          endTime: input.endTime,
          weeks,
          slotDay: input.dayKey,
          capacity: input.capacity,
          jauge: input.jauge ?? false,
        },
        ctx,
        serviceCapacity: service.capacity,
      });
      if (mirrorRows.length > 0) await tx.slot.createMany({ data: mirrorRows });
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
  // Contexte de génération UNIQUE (bornes + ouverture de l'exercice + fériés) —
  // période sans exercice = FERMÉ : aucun miroir, cf. opening.ts / loadMirrorContext.
  const ctx = await loadMirrorContext(prisma, {
    id: periodId,
    dateStart: period.dateStart,
    dateEnd: period.dateEnd,
    exerciceId: period.exerciceId,
  });

  const slots = await prisma.slot.findMany({
    where: { serviceId, periodId, slotType: "recurring" },
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
    await prisma.$transaction(
      async (tx) => {
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
              slotDay: s.slotDay,
              capacity: s.capacity,
              // La copie A↔B conserve la jauge du créneau source.
              jauge: s.jauge,
            },
          });
          // Un seul createMany par créneau copié (pipeline unique buildMirrorRows).
          const mirrorRows = buildMirrorRows({
            serviceId,
            periodId,
            slot: {
              id: newId,
              startTime: s.startTime,
              endTime: s.endTime,
              weeks: toWeek,
              slotDay: s.slotDay,
              capacity: s.capacity,
              jauge: s.jauge,
            },
            ctx,
            serviceCapacity: service.capacity,
          });
          if (mirrorRows.length > 0) await tx.slot.createMany({ data: mirrorRows });
          const ids = demBySlot.get(s.id);
          if (ids?.length) {
            await tx.slotDemandeur.createMany({
              data: ids.map((demandeurId) => ({ slotId: newId, demandeurId })),
            });
          }
          created++;
        }
        // Timeout élargi : la copie A↔B traite N créneaux × leurs miroirs en un lot.
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  return { ok: true, created };
}

/** Ajoute un créneau PONCTUEL daté (période résolue depuis la date). */
export async function addUniqueSlot(
  serviceId: string,
  input: {
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
    demandeurIds?: number[];
    // « A une jauge » : mode jauge de l'agenda au moment de la création.
    jauge?: boolean;
    // Identifiant de lot « multi » (créneaux répliqués en un geste) : commun à toute
    // la série, null pour un ponctuel isolé.
    batchId?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const periodId = await periodIdCoveringDate(serviceId, input.slotDate);
  if (periodId == null) {
    return { ok: false, error: `Aucune période ne couvre la date ${input.slotDate}` };
  }
  const id = newRecurId();
  const demandeurIds = normalizeDemandeurIds(input.demandeurIds);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.slot.create({
        data: {
          id,
          serviceId,
          slotType: "unique",
          startTime: input.startTime,
          endTime: input.endTime,
          slotDate: fromISO(input.slotDate),
          capacity: input.capacity,
          periodId,
          jauge: input.jauge ?? false,
          batchId: input.batchId ?? null,
        },
      });
      // Demandeurs autorisés posés dans la même transaction (cf. addRecurringSlot) :
      // un échec ici annule la création du créneau au lieu de l'ouvrir à tous.
      if (demandeurIds.length > 0) {
        await tx.slotDemandeur.createMany({
          data: demandeurIds.map((demandeurId) => ({ slotId: id, demandeurId })),
        });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
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
  const capVal = slot.capacity ?? service.capacity;
  const weeks = normalizeWeeks(slot.weeks);
  // Contexte de génération UNIQUE (bornes + ouverture de l'exercice + fériés) —
  // période sans exercice = FERMÉ : aucun miroir, cf. opening.ts / loadMirrorContext.
  const ctx = await loadMirrorContext(prisma, {
    id: period.id,
    dateStart: period.dateStart,
    dateEnd: period.dateEnd,
    exerciceId: period.exerciceId,
  });
  // Vérif « réservé » + suppression des miroirs + régénération dans UNE transaction
  // sérialisable : une réservation créée sur le créneau ou un miroir ENTRE le count et
  // le delete ne peut plus être supprimée en cascade sans être vue (Booking.slot est
  // onDelete: Cascade). Cohérent avec moveUniqueSlot — le count hors transaction
  // laissait sinon une fenêtre de perte silencieuse de réservation.
  let blocked = false;
  try {
    await prisma.$transaction(
      async (tx) => {
        const existingMirrors = await tx.slot.findMany({
          where: { parentSlotId: slotId },
          select: { id: true },
        });
        const bookingCount = await tx.booking.count({
          where: { slotId: { in: [slotId, ...existingMirrors.map((m) => m.id)] } },
        });
        if (bookingCount > 0) {
          blocked = true;
          return;
        }
        if (existingMirrors.length) {
          await tx.slot.deleteMany({ where: { id: { in: existingMirrors.map((m) => m.id) } } });
        }
        await tx.slot.update({
          where: { id: slotId },
          data: { startTime, endTime, weeks, slotDay: toDayKey, capacity: capVal },
        });
        // Un seul createMany (pipeline unique buildMirrorRows) ; miroirs régénérés
        // avec la jauge du récurrent déplacé.
        const mirrorRows = buildMirrorRows({
          serviceId,
          periodId: period.id,
          slot: {
            id: slotId,
            startTime,
            endTime,
            weeks,
            slotDay: toDayKey,
            capacity: capVal,
            jauge: slot.jauge,
          },
          ctx,
          serviceCapacity: service.capacity,
        });
        if (mirrorRows.length > 0) await tx.slot.createMany({ data: mirrorRows });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, merci de réessayer." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  if (blocked) {
    return { ok: false, error: "Créneau avec réservation : déplacement impossible." };
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
  const periodId = await periodIdCoveringDate(serviceId, slotDate);
  if (periodId == null) return { ok: false, error: `Aucune période ne couvre la date ${slotDate}` };
  // Vérif « réservé » + update dans UNE transaction sérialisable : une réservation créée
  // entre le count et l'update ne peut plus passer inaperçue (cohérent avec les autres
  // mutations de slot, toutes transactionnelles).
  let blocked = false;
  try {
    await prisma.$transaction(
      async (tx) => {
        if ((await tx.booking.count({ where: { slotId } })) > 0) {
          blocked = true;
          return;
        }
        await tx.slot.update({
          where: { id: slotId },
          data: { startTime, endTime, slotDate: fromISO(slotDate), periodId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, merci de réessayer." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Erreur" };
  }
  if (blocked) {
    return { ok: false, error: "Créneau avec réservation : déplacement impossible." };
  }
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
