"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { isBookingLockedByPointage } from "@/lib/agenda-core";
import { todayParisISO } from "@/lib/booking-delay";
import {
  bookingAccompagnantsSchema,
  bookingEnfantsSchema,
  bookingThemeSchema,
  hasBothParticipants,
  hasBothParticipantsMsg,
} from "@/schemas/booking";
import { DAYS } from "@/schemas/config";
import {
  MAX_CAPACITY,
  MIN_CAPACITY,
  recurringSlotCreateSchema,
  slotDateSchema,
  slotMoveTimesSchema,
  uniqueSlotBatchCreateSchema,
} from "@/schemas/slot";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import {
  sendBookingCancellationMail,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import {
  assertSlotCapacity,
  BookingError,
  effectiveOpenOnSchoolHolidays,
  mapBookingError,
  resolveEffectiveDemandeurId,
} from "@/server/services/bookings";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import {
  PARENT_FOR_SYNC_SELECT,
  syncRecurringChildren,
} from "@/server/services/recurring-children";
import {
  addRecurringSlot,
  addUniqueSlotBatch,
  cloneSlotAtTimes,
  copyPonctuelWeek,
  copyRecurringWeek,
  deleteSlots,
  moveRecurringSlot,
  moveUniqueSlot,
  moveUniqueSlotBatch,
} from "@/server/services/slots";

// Jours : source unique = DAYS (schemas/config). type DayKeyT en dérive (audit D2).
type DayKeyT = (typeof DAYS)[number];

const idSchema = z.coerce.number().int().positive();

/**
 * Sessions datées (occurrences) du service sur [fromYmd, toYmd] avec leurs participants
 * nominatifs — pour l'impression « liste » de l'agenda admin. Gardé gestionnaire.
 */
export async function listAgendaSessionsAction(
  serviceId: string,
  fromYmd: string,
  toYmd: string,
): Promise<DatedSession[]> {
  await requireServiceManager(serviceId);
  return listDatedSessions(serviceId, fromYmd, toYmd);
}

/** Un parent récurrent a-t-il au moins un miroir (enfant) POINTÉ ? → il devient immuable. */
async function parentLockedByPointage(parentId: number): Promise<boolean> {
  return (
    (await prisma.booking.count({
      where: { parentBookingId: parentId, pointage: { not: null } },
    })) > 0
  );
}

/**
 * Une réservation est-elle verrouillée pour toute action de gestion (supprimer,
 * modifier, déplacer, copier, valider) ? Règles :
 *   - un MIROIR (enfant, parentBookingId non null) est toujours immuable ;
 *   - une réservation autonome POINTÉE est verrouillée ;
 *   - un PARENT récurrent dont un miroir est pointé est verrouillé.
 * Seul le pointage d'un miroir échappe à ce verrou (géré à part).
 */
async function bookingLocked(b: {
  id: number;
  bookingType: string;
  parentBookingId: number | null;
  pointage: string | null;
}): Promise<boolean> {
  // Miroir pointé calculé en BDD ; le reste du prédicat est partagé avec le client.
  const hasPointedChild = b.bookingType === "recurring" && (await parentLockedByPointage(b.id));
  return isBookingLockedByPointage(b, hasPointedChild);
}

/**
 * Re-vérifie le verrou pointage/miroir DANS la transaction d'écriture (anti-TOCTOU,
 * audit 2026-07-17) : un pointage posé entre la lecture hors transaction et l'écriture
 * ne passe plus inaperçu. Le pré-contrôle hors transaction reste utile (message rapide),
 * mais c'est CETTE vérification qui fait foi. Lève BookingError.
 */
async function assertBookingUnlockedInTx(
  tx: Prisma.TransactionClient,
  bookingId: number,
  serviceId: string,
): Promise<void> {
  const b = await tx.booking.findFirst({
    where: { id: bookingId, serviceId },
    select: { id: true, bookingType: true, parentBookingId: true, pointage: true },
  });
  if (!b) throw new BookingError("Réservation introuvable.");
  const hasPointedChild =
    b.bookingType === "recurring" &&
    (await tx.booking.count({ where: { parentBookingId: b.id, pointage: { not: null } } })) > 0;
  if (isBookingLockedByPointage(b, hasPointedChild)) {
    throw new BookingError("Réservation verrouillée (séance pointée ou miroir).");
  }
}

export async function setBookingValidatedAction(
  bookingId: number,
  serviceId: string,
  validated: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const b = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      id: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      validated: true,
      userId: true,
      periodId: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      service: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  if (!b) return { ok: false, error: "Réservation introuvable." };
  // Miroir non validable ; parent/​autonome verrouillé par un pointage non plus.
  if (await bookingLocked(b)) {
    return { ok: false, error: "Réservation verrouillée (séance pointée ou miroir)." };
  }
  const changed = b.validated !== validated;
  // Validation au niveau de la SÉRIE : le parent + propagation à tous ses miroirs,
  // verrou pointage re-vérifié DANS la transaction (anti-TOCTOU, audit 2026-07-17).
  try {
    await prisma.$transaction(
      async (tx) => {
        await assertBookingUnlockedInTx(tx, id.data, serviceId);
        await tx.booking.update({ where: { id: id.data }, data: { validated } });
        await tx.booking.updateMany({ where: { parentBookingId: id.data }, data: { validated } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Modification simultanée détectée, réessayez." };
    }
    throw e;
  }
  revalidatePath(`/services/${serviceId}/agenda`);

  // Notifie l'usager d'une (dé)validation MANUELLE par le gestionnaire (best-effort,
  // uniquement sur transition réelle) : e-mail « validée » ou « en attente » (port legacy).
  if (changed && b.slot) {
    await sendBookingConfirmationMail({
      userId: b.userId,
      serviceId,
      serviceLabel: b.service?.label ?? "",
      // Validation → « Réservation confirmée » ; dévalidation → « Réservation remise en attente ».
      trigger: validated ? "confirm_validate" : "unvalidate",
      slot: b.slot,
      periodId: b.periodId,
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      theme: b.themeLabel ?? "",
    });
  }
  return { ok: true };
}

export async function setBookingPointageAction(
  bookingId: number,
  serviceId: string,
  pointage: "present" | "absent" | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Les parents (récurrents) NE sont PAS pointables : seuls les miroirs (et les
  // ponctuelles autonomes) le sont.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const b = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: { bookingType: true, slot: { select: { slotDate: true } } },
  });
  if (!b) return { ok: false, error: "Réservation introuvable." };
  if (b.bookingType === "recurring") {
    return { ok: false, error: "Une récurrente se pointe sur ses séances datées." };
  }
  // Pas de pointage AVANT la séance (jour de la séance accepté — on n'est pas à
  // l'heure près). Validée ou non, peu importe : le pointage constate le réel.
  // L'effacement est bloqué au même titre que la pose : aucune action de pointage
  // sur une séance future.
  if (b.slot.slotDate != null && b.slot.slotDate.toISOString().slice(0, 10) > todayParisISO()) {
    return { ok: false, error: "Impossible de pointer une séance qui n'a pas encore eu lieu." };
  }
  await prisma.booking.update({ where: { id: id.data }, data: { pointage } });
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Mode création (agenda) : enregistre la CONFIGURATION d'un créneau — sa capacité,
 * son mode jauge et la liste des demandeurs autorisés (vide = ouvert à tous).
 * Remplace l'ensemble des SlotDemandeur du créneau. Fonctionne pour les créneaux
 * récurrents comme ponctuels ; la jauge d'un récurrent est PROPAGÉE à ses miroirs
 * (ils portent la valeur du parent). Un créneau ponctuel « multiple » (batchId) →
 * la configuration s'applique à TOUT le lot (tous les créneaux jumeaux de la période).
 */
export async function saveSlotConfigAction(input: {
  serviceId: string;
  slotId: string;
  capacity: number;
  jauge: boolean;
  demandeurIds: number[];
  // true (mode « Création multiple ») → la config s'applique à tout le lot ; false/absent
  // (ponctuel/récurrent) → au seul créneau. Le SCOPE suit le mode courant, pas le batchId.
  wholeLot?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const { serviceId, slotId, capacity, demandeurIds } = input;
  const jauge = input.jauge === true;
  // Capacité : bornes partagées avec la création (schemas/slot.ts). Un créneau à 0
  // place le rendrait silencieusement irréservable.
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    return { ok: false, error: "Capacité invalide." };
  }
  const ids = [...new Set(demandeurIds.filter((d) => Number.isInteger(d) && d > 0))];
  // Anti-IDOR + message « introuvable » réel (pré-contrôle hors tx pour que le catch
  // ci-dessous ne serve qu'aux erreurs inattendues, loggées et non avalées — audit B2).
  const ref = await prisma.slot.findFirst({
    where: { id: slotId, serviceId },
    select: { id: true, batchId: true },
  });
  if (!ref) return { ok: false, error: "Créneau introuvable." };
  // Mode « Création multiple » (wholeLot) + créneau en lot (batchId) → la config s'applique
  // à TOUT le lot ; sinon au seul créneau (récurrent : + propagation jauge à ses miroirs).
  const targetIds =
    input.wholeLot && ref.batchId
      ? (
          await prisma.slot.findMany({
            where: { serviceId, batchId: ref.batchId },
            select: { id: true },
          })
        ).map((s) => s.id)
      : [slotId];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.slot.updateMany({ where: { id: { in: targetIds } }, data: { capacity, jauge } });
      // Miroirs d'un récurrent : la jauge suit le parent (cf. addRecurringSlot).
      await tx.slot.updateMany({ where: { parentSlotId: { in: targetIds } }, data: { jauge } });
      await tx.slotDemandeur.deleteMany({ where: { slotId: { in: targetIds } } });
      if (ids.length > 0) {
        await tx.slotDemandeur.createMany({
          data: targetIds.flatMap((sid) =>
            ids.map((demandeurId) => ({ slotId: sid, demandeurId })),
          ),
        });
      }
    });
  } catch (e) {
    console.error("[agenda] saveSlotConfig", e);
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Mode création (agenda, A/B) : copie d'une semaine A/B vers l'autre (même période)
 * LES CRÉNEAUX RÉCURRENTS (copyRecurringWeek) ET les LOTS « ponctuels multiples »
 * (copyPonctuelWeek). Non destructif. Les deux copies sont des transactions distinctes
 * mais additives et idempotentes (anti-doublon) : un échec de la seconde laisse la
 * première appliquée, un nouvel appel ne recopie pas ce qui existe déjà.
 */
export async function copyWeekSlotsAction(input: {
  serviceId: string;
  periodId: number;
  fromWeek: "A" | "B";
  toWeek: "A" | "B";
}): Promise<{ ok: boolean; error?: string; created?: number }> {
  await requireServiceManager(input.serviceId);
  const rec = await copyRecurringWeek(
    input.serviceId,
    input.periodId,
    input.fromWeek,
    input.toWeek,
  );
  if (!rec.ok) {
    revalidatePath(`/services/${input.serviceId}/agenda`);
    return { ok: false, error: rec.error };
  }
  const pon = await copyPonctuelWeek(input.serviceId, input.periodId, input.fromWeek, input.toWeek);
  revalidatePath(`/services/${input.serviceId}/agenda`);
  if (!pon.ok) return { ok: false, error: pon.error };
  return { ok: true, created: rec.created + pon.created };
}

// ─── Mode « Création de créneau » (agenda) ───────────────────────────────────

/**
 * Mode création (agenda) : met à jour la CAPACITÉ PAR DÉFAUT du service (`capacity`).
 * Autosave du champ « Capacité ».
 */
export async function setServiceDefaultCapacityAction(input: {
  serviceId: string;
  value: number;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  // Bornée [MIN, MAX] comme la création/reconfig (le défaut service n'avait pas de
  // plafond → un défaut > 9999 faisait ensuite échouer la validation à la création).
  const value = Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.floor(input.value)));
  if (!Number.isFinite(value)) return { ok: false, error: "Capacité invalide." };
  await prisma.service.update({
    where: { id: input.serviceId },
    data: { capacity: value },
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}

/**
 * Liste des usagers proposés dans la modale de création de réservation. Chargée À LA
 * DEMANDE (ouverture de la modale) : auparavant TOUS les comptes étaient chargés par
 * la page agenda et re-fetchés à chaque tick d'auto-rafraîchissement (audit perf).
 */
export async function listAgendaUsersAction(serviceId: string): Promise<
  {
    id: string;
    label: string;
    demandeur: string;
    structure: string;
    openOnSchoolHolidays: boolean;
    enfants: number;
    accompagnants: number;
  }[]
> {
  await requireServiceManager(serviceId);
  // Moindre privilège (audit 2026-07-19) : seuls les usagers dont le demandeur EFFECTIF
  // est accepté par CE service (matrice demandeurs) sont proposés — un gestionnaire ne
  // voyait sinon l'annuaire complet de la collectivité. Les comptes SANS demandeur
  // effectif restent proposés (cohérent avec userCanAccessService) ; les comptes
  // anonymisés sont exclus.
  const accepted = new Set(
    (
      await prisma.serviceDemandeurSettings.findMany({
        where: { serviceId },
        select: { demandeurId: true },
      })
    ).map((r) => r.demandeurId),
  );
  const users = await prisma.user.findMany({
    where: { role: "utilisateur", anonymizedAt: null },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    select: {
      id: true,
      nom: true,
      prenom: true,
      enfants: true,
      accompagnants: true,
      demandeurId: true,
      demandeur: { select: { label: true, openOnSchoolHolidays: true } },
      structure: {
        select: {
          label: true,
          demandeurId: true,
          demandeur: { select: { openOnSchoolHolidays: true } },
        },
      },
    },
  });
  return users
    .filter((u) => {
      const demId = resolveEffectiveDemandeurId(u);
      return demId == null || accepted.has(demId);
    })
    .map((u) => ({
      id: u.id,
      label: `${u.nom} ${u.prenom}`.trim() + (u.demandeur ? ` — ${u.demandeur.label}` : ""),
      demandeur: u.demandeur?.label ?? "",
      structure: u.structure?.label ?? "",
      // Politique vacances scolaires du demandeur EFFECTIF (direct, sinon structure ; false =
      // fermé → occurrences exclues).
      openOnSchoolHolidays: effectiveOpenOnSchoolHolidays(u),
      // Profil (préremplit Enfant/Adulte dans la modale de création à la sélection).
      enfants: u.enfants,
      accompagnants: u.accompagnants,
    }));
}

/** Crée un créneau récurrent (vue Modèle de période). */
export async function createRecurringSlotAction(input: {
  serviceId: string;
  periodId: number;
  dayKey: string;
  startTime: string;
  endTime: string;
  weeks: string;
  capacity: number;
  demandeurIds?: number[];
  // « A une jauge » : mode jauge de l'agenda au moment de la création.
  jauge?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  // Validation de la frontière : horaires (HH:MM, fin > début), capacité (entier ≥ 1),
  // jour et identifiants. Le typage TS ne protège pas une server action des entrées brutes.
  const parsed = recurringSlotCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  const res = await addRecurringSlot(d.serviceId, d.periodId, {
    startTime: d.startTime,
    endTime: d.endTime,
    weeks: d.weeks,
    dayKey: d.dayKey,
    capacity: d.capacity,
    demandeurIds: d.demandeurIds,
    jauge: d.jauge,
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Crée un LOT de créneaux ponctuels (« Création multiple ») : toutes les dates en UNE
 * transaction, batchId généré côté serveur (cf. addUniqueSlotBatch — l'orchestration
 * client par Promise.all pouvait laisser un demi-lot en base, audit 2026-07-19).
 */
export async function createUniqueSlotBatchAction(input: {
  serviceId: string;
  dates: string[];
  startTime: string;
  endTime: string;
  capacity: number;
  demandeurIds?: number[];
  jauge?: boolean;
  weeks?: string;
}): Promise<{ ok: boolean; error?: string; created?: number; skipped?: number }> {
  await requireServiceManager(input.serviceId);
  const parsed = uniqueSlotBatchCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  const res = await addUniqueSlotBatch(d.serviceId, {
    dates: d.dates,
    startTime: d.startTime,
    endTime: d.endTime,
    capacity: d.capacity,
    demandeurIds: d.demandeurIds,
    jauge: d.jauge,
    weeks: d.weeks,
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok
    ? { ok: true, created: res.created, skipped: res.skipped }
    : { ok: false, error: res.error };
}

/**
 * Clone un créneau existant à de nouveaux horaires (mêmes jour/date(s), type, parité,
 * capacité, jauge, demandeurs). Utilisé pour le découpage d'un redimensionnement qui
 * traverse la pause méridienne (le segment ancré reste sur le créneau d'origine, l'autre
 * segment devient ce clone — cf. cloneSlotAtTimes).
 */
export async function cloneSlotAtTimesAction(input: {
  serviceId: string;
  slotId: string;
  startTime: string;
  endTime: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const times = slotMoveTimesSchema.safeParse(input);
  if (!times.success) {
    return { ok: false, error: times.error.issues[0]?.message ?? "Données invalides." };
  }
  const res = await cloneSlotAtTimes(
    input.serviceId,
    input.slotId,
    times.data.startTime,
    times.data.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Déplace un créneau récurrent vide (jour + horaires) depuis l'agenda. */
export async function moveRecurringSlotAction(input: {
  serviceId: string;
  slotId: string;
  fromDayKey: string;
  toDayKey: string;
  startTime: string;
  endTime: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  if (
    !(DAYS as readonly string[]).includes(input.fromDayKey) ||
    !(DAYS as readonly string[]).includes(input.toDayKey)
  ) {
    return { ok: false, error: "Jour invalide." };
  }
  // Frontière : horaires validés comme à la création (HH:MM strict, fin > début) —
  // ils étaient persistés bruts (audit 2026-07-19).
  const times = slotMoveTimesSchema.safeParse(input);
  if (!times.success) {
    return { ok: false, error: times.error.issues[0]?.message ?? "Données invalides." };
  }
  const res = await moveRecurringSlot(
    input.serviceId,
    input.slotId,
    input.fromDayKey as DayKeyT,
    input.toDayKey as DayKeyT,
    times.data.startTime,
    times.data.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Déplace un créneau ponctuel vide (date + horaires) depuis l'agenda. */
export async function moveUniqueSlotAction(input: {
  serviceId: string;
  slotId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  // Frontière : date + horaires validés comme à la création — ils étaient persistés
  // bruts (audit 2026-07-19 ; une date invalide finissait en 500 Prisma).
  const date = slotDateSchema.safeParse(input.slotDate);
  const times = slotMoveTimesSchema.safeParse(input);
  if (!date.success || !times.success) {
    return {
      ok: false,
      error:
        (date.success ? undefined : date.error.issues[0]?.message) ??
        (times.success ? undefined : times.error.issues[0]?.message) ??
        "Données invalides.",
    };
  }
  const res = await moveUniqueSlot(
    input.serviceId,
    input.slotId,
    date.data,
    times.data.startTime,
    times.data.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Supprime un créneau (et ses miroirs/réservations) depuis l'agenda. */
export async function deleteSlotAction(
  serviceId: string,
  slotId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const res = await deleteSlots(serviceId, [slotId]);
  revalidatePath(`/services/${serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Supprime un créneau ponctuel ET tout son LOT « multi » : tous les créneaux
 * partageant son `batchId` (créneaux répliqués en un seul geste de « Création
 * multiple »). Le lot est résolu CÔTÉ SERVEUR depuis le créneau de référence (la
 * liste client peut être périmée). Créneau sans `batchId` → suppression simple.
 */
export async function deleteSlotSeriesAction(
  serviceId: string,
  slotId: string,
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  await requireServiceManager(serviceId);
  const ref = await prisma.slot.findFirst({
    where: { id: slotId, serviceId, slotType: "unique" },
    select: { batchId: true },
  });
  if (!ref) return { ok: false, error: "Créneau introuvable." };
  // Hors lot → suppression du seul créneau de référence.
  if (!ref.batchId) {
    const res = await deleteSlots(serviceId, [slotId]);
    revalidatePath(`/services/${serviceId}/agenda`);
    return res.ok ? { ok: true, deleted: res.deleted } : { ok: false, error: res.error };
  }
  const batch = await prisma.slot.findMany({
    where: { serviceId, batchId: ref.batchId },
    select: { id: true },
  });
  const ids = batch.map((s) => s.id);
  if (!ids.includes(slotId)) ids.push(slotId);
  const res = await deleteSlots(serviceId, ids);
  revalidatePath(`/services/${serviceId}/agenda`);
  return res.ok ? { ok: true, deleted: res.deleted } : { ok: false, error: res.error };
}

// Décale une date (Date @db.Date = minuit UTC) de `days` jours, en AAAA-MM-JJ.
function shiftYmd(date: Date, days: number): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
  return d.toISOString().slice(0, 10);
}

/** Un créneau du lot modifié, avec son état ANTÉRIEUR (pour l'annulation). */
export type BatchUpdatedItem = {
  id: string;
  slotDate: string;
  startTime: string;
  endTime: string;
};

/**
 * Applique un redimensionnement / déplacement à TOUT le lot « multi » d'un créneau
 * (créneaux partageant son `batchId`), sur l'ENSEMBLE des occurrences (passé compris — le
 * geste redéfinit la série entière ; les occurrences réservées sont protégées, cf. plus bas).
 * `dayDelta` = décalage de jour (0 pour un redimensionnement ou un même-jour). Chaque occurrence passe par
 * `moveUniqueSlot` (gardes réservation/période réutilisées) : une occurrence réservée
 * ou hors période est IGNORÉE (comptée dans `skipped`). Renvoie l'état ANTÉRIEUR des
 * occurrences modifiées pour permettre l'annulation. Créneau sans lot → repli sur le
 * seul créneau (déplacement simple à la date du geste).
 */
export async function updateSlotBatchAction(input: {
  serviceId: string;
  slotId: string;
  startTime: string;
  endTime: string;
  // Date du créneau de référence (geste courant), pour le repli hors-lot.
  refSlotDate: string;
  dayDelta?: number;
}): Promise<{
  ok: boolean;
  updated?: BatchUpdatedItem[];
  skipped?: number;
  error?: string;
}> {
  await requireServiceManager(input.serviceId);
  // Frontière : date + horaires validés comme à la création (persistés bruts avant
  // l'audit 2026-07-19) ; dayDelta borné (décalage d'un geste de drag, jamais plus
  // d'une semaine en pratique).
  const refDate = slotDateSchema.safeParse(input.refSlotDate);
  const parsedTimes = slotMoveTimesSchema.safeParse(input);
  if (!refDate.success || !parsedTimes.success) {
    return {
      ok: false,
      error:
        (refDate.success ? undefined : refDate.error.issues[0]?.message) ??
        (parsedTimes.success ? undefined : parsedTimes.error.issues[0]?.message) ??
        "Données invalides.",
    };
  }
  if (
    input.dayDelta != null &&
    (!Number.isInteger(input.dayDelta) || Math.abs(input.dayDelta) > 31)
  ) {
    return { ok: false, error: "Données invalides." };
  }
  const { serviceId, slotId } = input;
  const { startTime, endTime } = parsedTimes.data;
  const refSlotDate = refDate.data;
  const dayDelta = input.dayDelta ?? 0;
  const ref = await prisma.slot.findFirst({
    where: { id: slotId, serviceId, slotType: "unique" },
    select: { batchId: true },
  });
  if (!ref) return { ok: false, error: "Créneau introuvable." };
  // Hors lot → déplacement du seul créneau à la date du geste (parité avec l'unitaire).
  if (!ref.batchId) {
    const res = await moveUniqueSlot(serviceId, slotId, refSlotDate, startTime, endTime);
    revalidatePath(`/services/${serviceId}/agenda`);
    return res.ok ? { ok: true, updated: [], skipped: 0 } : { ok: false, error: res.error };
  }
  // Redimensionnement / déplacement appliqué à TOUT le lot, passé compris : le geste
  // redéfinit le créneau (durée ou jour) pour l'ensemble de la série, de façon cohérente
  // (sinon le lot se scinderait — passé à l'ancienne place, futur à la nouvelle). Les
  // occurrences réservées restent IGNORÉES par moveUniqueSlot (le passé « réel » est donc
  // protégé). Audit 2026-07-20 : le décompte à venir tombait à 0 sur une période passée et
  // rien n'était modifié.
  const siblings = await prisma.slot.findMany({
    where: { serviceId, batchId: ref.batchId },
    select: { id: true, slotDate: true, startTime: true, endTime: true },
    orderBy: { slotDate: "asc" },
  });
  // Tout le lot en UNE transaction sérialisable (audit perf 2026-07-19 — l'ancienne
  // boucle ouvrait une transaction PAR occurrence : ~2-5 s par geste sur un lot
  // annuel, et un crash à mi-boucle laissait un demi-lot déplacé). Les occurrences
  // réservées/hors période restent ignorées une à une (comptées dans `skipped`).
  const candidates = siblings.filter(
    (s): s is (typeof siblings)[number] & { slotDate: Date } => s.slotDate != null,
  );
  const prevOf = (s: (typeof candidates)[number]): BatchUpdatedItem => ({
    id: s.id,
    slotDate: shiftYmd(s.slotDate, 0),
    startTime: s.startTime,
    endTime: s.endTime,
  });
  const res = await moveUniqueSlotBatch(
    serviceId,
    candidates.map((s) => ({
      id: s.id,
      slotDate: dayDelta ? shiftYmd(s.slotDate, dayDelta) : shiftYmd(s.slotDate, 0),
      startTime,
      endTime,
    })),
  );
  if (!res.ok) {
    revalidatePath(`/services/${serviceId}/agenda`);
    return { ok: false, error: res.error };
  }
  const moved = new Set(res.movedIds);
  const updated = candidates.filter((s) => moved.has(s.id)).map(prevOf);
  const skipped = siblings.length - updated.length;
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true, updated, skipped };
}

/**
 * Annulation d'un `updateSlotBatchAction` : restaure chaque occurrence à son état
 * antérieur (date + horaires). Chaque restauration repasse par `moveUniqueSlot`
 * (gardes réutilisées ; une occurrence réservée entre-temps est ignorée).
 */
// Items d'annulation de lot : id + date + horaires validés (frontière), liste bornée
// (un lot annuel ≈ 36 occurrences ; 400 = marge large, évite un tableau non borné).
const revertItemsSchema = z
  .array(
    z.object({ id: z.string().min(1).max(64), slotDate: slotDateSchema }).and(slotMoveTimesSchema),
  )
  .max(400);

export async function revertSlotBatchAction(input: {
  serviceId: string;
  items: BatchUpdatedItem[];
}): Promise<{ ok: boolean; reverted?: number; error?: string }> {
  await requireServiceManager(input.serviceId);
  const items = revertItemsSchema.safeParse(input.items);
  if (!items.success) {
    return { ok: false, error: items.error.issues[0]?.message ?? "Données invalides." };
  }
  // Toute l'annulation en UNE transaction sérialisable (cf. updateSlotBatchAction) ;
  // une occurrence réservée entre-temps reste ignorée.
  const res = await moveUniqueSlotBatch(input.serviceId, items.data);
  revalidatePath(`/services/${input.serviceId}/agenda`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, reverted: res.movedIds.length };
}

/**
 * Supprime une réservation depuis l'agenda + notifie l'usager par e-mail.
 * Le mail informe que la réservation « a été supprimée » (si elle était validée) ou
 * « n'a pas été validée » (sinon) ; le `motif` saisi par le gestionnaire y est ajouté.
 * L'envoi est best-effort : un échec d'e-mail ne fait pas échouer la suppression.
 */
export async function deleteBookingAdminAction(
  bookingId: number,
  serviceId: string,
  motif?: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Infos nécessaires au mail + verrou, lues AVANT la suppression.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const booking = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      validated: true,
      periodId: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      userId: true,
      slotId: true,
    },
  });
  if (!booking) return { ok: false, error: "Réservation introuvable." };
  // Miroir immuable, ou réservation/​parent verrouillé par un pointage → pas de suppression.
  if (
    await bookingLocked({
      id: id.data,
      bookingType: booking.bookingType,
      parentBookingId: booking.parentBookingId,
      pointage: booking.pointage,
    })
  ) {
    return { ok: false, error: "Réservation verrouillée (séance pointée ou miroir)." };
  }
  // Suppression avec verrou re-vérifié DANS la transaction (anti-TOCTOU : un pointage
  // posé entre le contrôle ci-dessus et le delete ne passe plus).
  try {
    await prisma.$transaction(
      async (tx) => {
        await assertBookingUnlockedInTx(tx, id.data, serviceId);
        await tx.booking.delete({ where: { id: id.data } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Suppression simultanée détectée, réessayez." };
    }
    throw e;
  }
  revalidatePath(`/services/${serviceId}/agenda`);

  // Notification (best-effort, jamais bloquante) via le canal COMMUN d'annulation :
  // réglages globaux « Envoyer »/« Destinataire »/« Modèle » du déclencheur honorés
  // (l'ancien envoi direct à l'usager ignorait le réglage Destinataire — audit
  // 2026-07-17). Suppression d'une réservation validée vs refus d'une demande.
  await sendBookingCancellationMail({
    userId: booking.userId,
    serviceId,
    slotId: booking.slotId,
    periodId: booking.periodId,
    motif: (motif ?? "").trim().slice(0, 1000),
    trigger: booking.validated ? "cancel_manager" : "refuse",
  });
  return { ok: true };
}

const detailSchema = z
  .object({
    bookingId: z.coerce.number().int().positive(),
    serviceId: z.string().min(1),
    // Bornes UNIQUES 0-999 (schemas/booking) — l'édition plafonnait à 99 là où la
    // création acceptait 999 (audit 2026-07-17).
    enfants: bookingEnfantsSchema,
    accompagnants: bookingAccompagnantsSchema,
    theme: bookingThemeSchema,
  })
  // Au moins 1 enfant ET 1 accompagnant — même invariant qu'à la création, jusqu'ici
  // absent de l'édition (un gestionnaire pouvait ramener une résa à 0/0).
  .refine(hasBothParticipants, hasBothParticipantsMsg);

/**
 * Met à jour les détails d'une réservation depuis la modale « 📋 Réservation » :
 * compteurs enfants/accompagnants + thème (UNE seule action, équivalent legacy
 * `update_counts` + `update_theme`). Refuse si la réservation est pointée.
 */
export async function updateBookingDetailAction(input: {
  bookingId: number;
  serviceId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const current = await prisma.booking.findFirst({
    where: { id: d.bookingId, serviceId: d.serviceId },
    select: {
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      slotId: true,
      periodId: true,
    },
  });
  if (!current) return { ok: false, error: "Réservation introuvable." };
  if (current.parentBookingId != null) {
    return { ok: false, error: "Une séance (miroir) n'est pas modifiable." };
  }
  if (await bookingLocked({ id: d.bookingId, ...current })) {
    return { ok: false, error: "Réservation pointée, non modifiable." };
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // Verrou pointage re-vérifié dans la transaction (anti-TOCTOU).
        await assertBookingUnlockedInTx(tx, d.bookingId, d.serviceId);
        // Anti-surbooking : augmenter les compteurs ne doit pas dépasser la jauge/capacité
        // (la réservation courante est exclue du décompte).
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: current.slotId,
          bookingType: current.bookingType === "recurring" ? "recurring" : "unique",
          periodId: current.periodId,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
          excludeBookingId: d.bookingId,
        });
        await tx.booking.update({
          where: { id: d.bookingId },
          data: { enfants: d.enfants, accompagnants: d.accompagnants, themeLabel: d.theme },
        });
        const b = await tx.booking.findUnique({
          where: { id: d.bookingId },
          // Select UNIQUE du parent à resynchroniser (+ bookingType pour la branche).
          select: { ...PARENT_FOR_SYNC_SELECT, bookingType: true },
        });
        // Récurrente : propage counts/thème aux réservations-enfants.
        // Gestionnaire : pas de délai de réservation, on borne juste au présent.
        if (b && b.bookingType === "recurring")
          await syncRecurringChildren(tx, b, { cutoffISO: todayParisISO() });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Modification simultanée détectée, réessayez." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}

/** Déplace une réservation vers un autre créneau (glisser-déposer). Le jour est porté
 * par le créneau cible (slotDay) : changer de jour = changer de slotId. */
export async function moveBookingAction(
  bookingId: number,
  serviceId: string,
  slotId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Miroir immuable / réservation verrouillée par un pointage → pas de déplacement.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const lk = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      id: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      periodId: true,
      enfants: true,
      accompagnants: true,
    },
  });
  if (!lk) return { ok: false, error: "Réservation introuvable." };
  if (await bookingLocked(lk)) return { ok: false, error: "Réservation verrouillée." };
  try {
    await prisma.$transaction(
      async (tx) => {
        // Verrou pointage re-vérifié dans la transaction (anti-TOCTOU).
        await assertBookingUnlockedInTx(tx, id.data, serviceId);
        // Défense en profondeur (audit 2026-07-17) : créneau cible du MÊME service et
        // du MÊME type que la réservation (récurrent→récurrent, ponctuel→ponctuel),
        // comme le chemin usager (moveInTx). La période SUIT le créneau cible : sans
        // cette mise à jour, la jauge restait décomptée sur la partition
        // {slotId, ancienne période} → sous-comptage et sur-réservation possibles.
        const wantType = lk.bookingType === "recurring" ? "recurring" : "unique";
        const target = await tx.slot.findFirst({
          where: { id: slotId, serviceId },
          select: { slotType: true, periodId: true, weeks: true },
        });
        if (!target || target.slotType !== wantType) {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        if (wantType === "recurring" && !(target.periodId != null && target.periodId > 0)) {
          throw new BookingError("Période requise pour une réservation récurrente.");
        }
        // Récurrent → période du créneau cible ; ponctuel → aucune période (NULL),
        // aligné sur le chemin usager.
        const newPeriodId = wantType === "recurring" ? target.periodId : null;
        // La parité SUIT le créneau cible (Slot.weeks), comme à la création — figée à
        // l'ancienne valeur, une récurrente "A" déposée sur un créneau "B" gardait sa
        // parité et syncRecurringChildren supprimait TOUTES ses occurrences (aucun
        // miroir compatible) : réservation fantôme (audit 2026-07-19).
        const newWeek =
          wantType === "recurring" && (target.weeks === "A" || target.weeks === "B")
            ? target.weeks
            : "";
        // Anti-surbooking : déplacer vers un créneau complet est refusé (jauge/capacité).
        await assertSlotCapacity(tx, {
          serviceId,
          slotId,
          bookingType: wantType,
          periodId: newPeriodId,
          enfants: lk.enfants,
          accompagnants: lk.accompagnants,
          excludeBookingId: id.data,
        });
        await tx.booking.update({
          where: { id: id.data },
          // auto_validate_from réinitialisé à NOW() sur un déplacement (cf. logique d'origine).
          data: { slotId, periodId: newPeriodId, week: newWeek, autoValidateFrom: new Date() },
        });
        const b = await tx.booking.findUnique({
          where: { id: id.data },
          // Select UNIQUE du parent à resynchroniser (+ bookingType pour la branche).
          select: { ...PARENT_FOR_SYNC_SELECT, bookingType: true },
        });
        // Récurrente : régénère les enfants sur les miroirs du nouveau créneau.
        // Gestionnaire : pas de délai de réservation, on borne juste au présent.
        if (b && b.bookingType === "recurring")
          await syncRecurringChildren(tx, b, { cutoffISO: todayParisISO() });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Déplacement simultané détecté, réessayez." };
    }
    throw e;
  }
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

const createSchema = z
  .object({
    serviceId: z.string().min(1),
    slotId: z.string().min(1),
    periodId: z.coerce.number().int().positive(),
    dayKey: z.string().min(1),
    userId: z.string().min(1),
    enfants: bookingEnfantsSchema.default(0),
    accompagnants: bookingAccompagnantsSchema.default(0),
    theme: bookingThemeSchema.default(""),
    week: z.enum(["", "A", "B"]).default(""),
  })
  .refine(hasBothParticipants, hasBothParticipantsMsg);

/** Crée une réservation récurrente (clic sur un créneau vide de l'agenda). */
export async function createRecurringBookingAction(input: {
  serviceId: string;
  slotId: string;
  periodId: number;
  dayKey: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  week: "" | "A" | "B";
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  try {
    await prisma.$transaction(
      async (tx) => {
        // Défense en profondeur : le créneau cible doit être un récurrent ACTIF du service
        // (comme createUniqueBookingInTx pour le ponctuel). Évite une récurrente posée sur
        // un créneau ponctuel/désactivé via un slotId forgé, que syncRecurringChildren
        // propagerait ensuite. (assertSlotCapacity ne contrôle que le couple slot/service.)
        const target = await tx.slot.findFirst({
          where: { id: d.slotId, serviceId: d.serviceId },
          select: { slotType: true, periodId: true, weeks: true },
        });
        if (target?.slotType !== "recurring") {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        // Anti-injection : la période annoncée DOIT être celle du créneau — la jauge et
        // l'unicité uq_recurring sont cloisonnées par {slotId, periodId}, un periodId
        // forgé les contournerait et matérialiserait les occurrences sur la mauvaise
        // plage. Même garde que le chemin usager (reserveRecurringInTx).
        if (target.periodId !== d.periodId) {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        // La réservation SUIT la parité du CRÉNEAU (Slot.weeks), pas la semaine annoncée par
        // le client : "A"/"B" → cette parité ; "" (toutes semaines) → toutes les occurrences.
        const slotWeek = target.weeks === "A" || target.weeks === "B" ? target.weeks : "";
        // Anti-surbooking : le gestionnaire ne peut pas dépasser la jauge/capacité.
        // (pas de délai de réservation côté gestionnaire, mais la capacité s'applique.)
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: d.slotId,
          bookingType: "recurring",
          periodId: d.periodId,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
        });
        const created = await tx.booking.create({
          data: {
            bookingType: "recurring",
            userId: d.userId,
            serviceId: d.serviceId,
            slotId: d.slotId,
            periodId: d.periodId,
            week: slotWeek,
            enfants: d.enfants,
            accompagnants: d.accompagnants,
            themeLabel: d.theme,
            validated: true,
            autoValidateFrom: new Date(),
          },
        });
        await syncRecurringChildren(
          tx,
          {
            id: created.id,
            userId: d.userId,
            serviceId: d.serviceId,
            slotId: d.slotId,
            periodId: d.periodId,
            week: slotWeek,
            themeLabel: d.theme,
            enfants: d.enfants,
            accompagnants: d.accompagnants,
            validated: true,
          },
          // Gestionnaire : pas de délai de réservation (borne au présent).
          { cutoffISO: todayParisISO() },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    // Source unique du mapping (bookings.mapBookingError) — message doublon admin.
    return mapBookingError(e, {
      duplicate: "Cet usager a déjà une réservation sur ce créneau.",
    });
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  // Confirmation à l'usager (best-effort) : réservation créée par un gestionnaire = validée.
  const slot = await prisma.slot.findUnique({
    where: { id: d.slotId },
    select: {
      startTime: true,
      endTime: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (slot) {
    await sendBookingConfirmationMail({
      userId: d.userId,
      serviceId: d.serviceId,
      serviceLabel: slot.service.label,
      trigger: "confirm_manager_create",
      slot: {
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotDate: null,
        slotDay: slot.slotDay,
      },
      periodId: d.periodId,
      enfants: d.enfants,
      accompagnants: d.accompagnants,
      theme: d.theme,
    });
  }
  return { ok: true };
}

const createUniqueSchema = z
  .object({
    serviceId: z.string().min(1),
    slotId: z.string().min(1),
    userId: z.string().min(1),
    enfants: bookingEnfantsSchema.default(0),
    accompagnants: bookingAccompagnantsSchema.default(0),
    theme: bookingThemeSchema.default(""),
  })
  .refine(hasBothParticipants, hasBothParticipantsMsg);

/**
 * Crée une réservation PONCTUELLE (clic sur un créneau ponctuel de l'agenda).
 * Insert direct validé côté admin : pas de jauge ni de délai de réservation (le
 * gestionnaire peut réserver n'importe quel créneau FUTUR), mais on refuse une date
 * déjà passée. Un ponctuel n'a ni période ni jour : periodId=0, dayKey="" et week="".
 */
export async function createUniqueBookingAction(input: {
  serviceId: string;
  slotId: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const parsed = createUniqueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  const slot = await prisma.slot.findUnique({
    where: { id: d.slotId },
    select: {
      slotType: true,
      serviceId: true,
      startTime: true,
      endTime: true,
      slotDate: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (slot?.slotType !== "unique" || slot.serviceId !== d.serviceId) {
    return { ok: false, error: "Créneau introuvable." };
  }
  // Gestionnaire : pas de délai, mais on n'autorise pas une date déjà passée.
  if (slot.slotDate && slot.slotDate.toISOString().slice(0, 10) < todayParisISO()) {
    return { ok: false, error: "Ce créneau est passé." };
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // Anti-surbooking : le gestionnaire ne peut pas dépasser la jauge/capacité.
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: d.slotId,
          bookingType: "unique",
          periodId: 0,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
        });
        await tx.booking.create({
          data: {
            bookingType: "unique",
            userId: d.userId,
            serviceId: d.serviceId,
            slotId: d.slotId,
            periodId: null,
            week: "",
            enfants: d.enfants,
            accompagnants: d.accompagnants,
            themeLabel: d.theme,
            validated: true,
            autoValidateFrom: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    // Source unique du mapping (bookings.mapBookingError) — message doublon admin.
    return mapBookingError(e, {
      duplicate: "Cet usager a déjà une réservation sur ce créneau.",
    });
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  // Confirmation à l'usager (best-effort) : réservation créée par un gestionnaire = validée.
  await sendBookingConfirmationMail({
    userId: d.userId,
    serviceId: d.serviceId,
    serviceLabel: slot.service.label,
    trigger: "confirm_manager_create",
    slot: {
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotDate: slot.slotDate,
      slotDay: slot.slotDay,
    },
    enfants: d.enfants,
    accompagnants: d.accompagnants,
    theme: d.theme,
  });
  return { ok: true };
}

const copyTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recurring"),
    periodId: z.coerce.number().int().positive(),
    dayKey: z.string().min(1),
    slotId: z.string().min(1),
    week: z.enum(["", "A", "B"]).default(""),
  }),
  z.object({
    kind: z.literal("unique"),
    slotId: z.string().min(1),
  }),
]);

/**
 * Copie une réservation existante vers un autre créneau : lit l'usager + les
 * compteurs + le thème de la source, puis recrée une réservation sur la cible
 * (récurrente ou ponctuelle) via les actions de création. La source est conservée
 * (copier, pas couper). Le contrôle d'unicité (P2002) renvoie une erreur lisible.
 */
export async function copyBookingAction(input: {
  serviceId: string;
  sourceBookingId: number;
  target:
    | { kind: "recurring"; periodId: number; dayKey: string; slotId: string; week: "" | "A" | "B" }
    | { kind: "unique"; slotId: string };
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const id = idSchema.safeParse(input.sourceBookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  const target = copyTargetSchema.safeParse(input.target);
  if (!target.success) return { ok: false, error: "Cible invalide." };
  const src = await prisma.booking.findUnique({
    where: { id: id.data },
    select: {
      userId: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      serviceId: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
    },
  });
  if (!src || src.serviceId !== input.serviceId) {
    return { ok: false, error: "Réservation introuvable." };
  }
  // Miroir non copiable ; source verrouillée par un pointage non plus.
  if (
    await bookingLocked({
      id: id.data,
      bookingType: src.bookingType,
      parentBookingId: src.parentBookingId,
      pointage: src.pointage,
    })
  ) {
    return { ok: false, error: "Réservation non copiable (séance pointée ou miroir)." };
  }
  if (target.data.kind === "recurring") {
    return createRecurringBookingAction({
      serviceId: input.serviceId,
      slotId: target.data.slotId,
      periodId: target.data.periodId,
      dayKey: target.data.dayKey,
      userId: src.userId,
      enfants: src.enfants,
      accompagnants: src.accompagnants,
      theme: src.themeLabel ?? "",
      week: target.data.week,
    });
  }
  return createUniqueBookingAction({
    serviceId: input.serviceId,
    slotId: target.data.slotId,
    userId: src.userId,
    enfants: src.enfants,
    accompagnants: src.accompagnants,
    theme: src.themeLabel ?? "",
  });
}

/**
 * Coupe une réservation vers un autre créneau : recrée la réservation sur la cible
 * (comme copier), puis supprime la source si la création a réussi. Si la création
 * échoue (ex. doublon), la source est conservée et l'erreur est renvoyée.
 */
export async function cutBookingAction(input: {
  serviceId: string;
  sourceBookingId: number;
  target:
    | { kind: "recurring"; periodId: number; dayKey: string; slotId: string; week: "" | "A" | "B" }
    | { kind: "unique"; slotId: string };
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
  const res = await copyBookingAction(input);
  if (!res.ok) return res;
  const id = idSchema.safeParse(input.sourceBookingId);
  if (id.success) {
    // La copie est committée : si la suppression de la source échoue, on le DIT
    // (sinon : doublon silencieux consommant la jauge). Scopée au service (anti-IDOR).
    const del = await prisma.booking
      .deleteMany({ where: { id: id.data, serviceId: input.serviceId } })
      .catch(() => null);
    if (!del || del.count === 0) {
      revalidatePath(`/services/${input.serviceId}/agenda`);
      return {
        ok: false,
        error:
          "Réservation copiée, mais la source n'a pas pu être supprimée — retirez-la manuellement.",
      };
    }
  }
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}
