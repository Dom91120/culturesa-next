import { slotWeekTag } from "@/lib/iso-week";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";

// Helpers de l'agenda admin (mode « Création de créneau ») : ajout/copie/déplacement/
// suppression de créneaux + génération de leurs miroirs. L'API « upsert en masse »
// de l'ancien onglet Créneaux (saveRecurringSlots/saveUniqueSlots, getCreneauxData,
// CRUD unitaire) a été supprimée avec l'onglet (audit code mort 2026-06).

// ─── Constants & helpers ───────────────────────────────────────────

// Jours de la semaine : source unique = DAYS (schemas/config), aussi adossée à
// l'enum Zod. type DayKey en dérive (audit duplication D2).
type DayKey = (typeof DAYS)[number];

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

/** Un service est-il en mode semaine A/B ? (au moins un demandeur avec semaineAb). */
async function serviceHasAbMode(serviceId: string): Promise<boolean> {
  return (
    (await prisma.serviceDemandeurSettings.count({ where: { serviceId, semaineAb: true } })) > 0
  );
}

/**
 * Modèle « 1 créneau = 1 semaine » en mode A/B : un créneau récurrent doit porter la
 * semaine A OU B (jamais « A & B »). On évite ainsi qu'un même créneau cumule les
 * réservations des deux semaines dans un seul seau de capacité. (Hors mode A/B, `weeks`
 * vaut « A,B » = toutes les semaines, ce qui reste valide.) Renvoie un message d'erreur
 * si la valeur est invalide pour un service A/B, sinon null.
 */
function abWeekError(weeks: string | null | undefined): string | null {
  const w = (weeks ?? "").trim();
  return w === "A" || w === "B"
    ? null
    : "En mode A/B, un créneau doit être sur la semaine A ou la semaine B (pas « A & B »).";
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

// ─── Mirror generation (ported from api/slots.php save_recurring) ───

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
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return { ok: false, error: "Service introuvable" };
  const period = await prisma.period.findFirst({ where: { id: periodId, serviceId } });
  if (!period?.dateStart || !period?.dateEnd) {
    return { ok: false, error: "Période introuvable ou sans dates" };
  }
  if (await serviceHasAbMode(serviceId)) {
    const err = abWeekError(input.weeks);
    if (err) return { ok: false, error: err };
  }
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAYS.includes(d as DayKey));
  const weeks = normalizeWeeks(input.weeks);
  const holidays = await prisma.periodHoliday.findMany({
    where: { periodId },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => toISO(h.date)));
  // Hoisté hors transaction : la restriction de nullité ne survit pas dans la closure.
  const startDate = toISO(period.dateStart);
  const endDate = toISO(period.dateEnd);
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
          state: "actif",
          slotDay: input.dayKey,
          capacity: input.capacity,
        },
      });
      // Demandeurs autorisés posés dans la même transaction : un échec ici annule
      // la création du créneau (sinon créneau ouvert à tous au lieu de restreint).
      if (demandeurIds.length > 0) {
        await tx.slotDemandeur.createMany({
          data: demandeurIds.map((demandeurId) => ({ slotId: slId, demandeurId })),
        });
      }
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
      // Un seul createMany : un INSERT par miroir risquait le timeout de transaction
      // Prisma (5 s par défaut) sur une période annuelle.
      const mirrorRows = [...wanted.values()].map((mv) => ({
        id: mirrorId(slId, mv.date),
        serviceId,
        slotType: "unique" as const,
        startTime: input.startTime,
        endTime: input.endTime,
        slotDate: fromISO(mv.date),
        capacity: mv.cap,
        periodId,
        parentSlotId: slId,
        state: "actif" as const,
      }));
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
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAYS.includes(d as DayKey));
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
          // Un seul createMany par créneau copié (cf. addRecurringSlot : anti-timeout).
          const mirrorRows = [...wanted.values()].map((mv) => ({
            id: mirrorId(newId, mv.date),
            serviceId,
            slotType: "unique" as const,
            startTime: s.startTime,
            endTime: s.endTime,
            slotDate: fromISO(mv.date),
            capacity: mv.cap,
            periodId,
            parentSlotId: newId,
            state: "actif" as const,
          }));
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
  },
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
          periodId: period.id,
          state: "actif",
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
  const weeks = normalizeWeeks(slot.weeks);
  const activeDays = service.activeDays
    .split(",")
    .filter((d): d is DayKey => DAYS.includes(d as DayKey));
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
      // Un seul createMany (cf. addRecurringSlot : anti-timeout).
      const mirrorRows = [...wanted.values()].map((mv) => ({
        id: mirrorId(slotId, mv.date),
        serviceId,
        slotType: "unique" as const,
        startTime,
        endTime,
        slotDate: fromISO(mv.date),
        capacity: mv.cap,
        periodId: period.id,
        parentSlotId: slotId,
        state: "actif" as const,
      }));
      if (mirrorRows.length > 0) await tx.slot.createMany({ data: mirrorRows });
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
