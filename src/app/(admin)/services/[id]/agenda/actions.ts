"use server";

import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import {
  addRecurringSlot,
  addUniqueSlot,
  copyRecurringWeek,
  deleteSlots,
  moveRecurringSlot,
  moveUniqueSlot,
} from "@/server/services/slots";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
type DayKeyT = (typeof DAY_KEYS)[number];

const idSchema = z.coerce.number().int().positive();

export async function setBookingValidatedAction(
  bookingId: number,
  serviceId: string,
  validated: boolean,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { validated } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

export async function setBookingPointageAction(
  bookingId: number,
  serviceId: string,
  pointage: "present" | "absent" | null,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { pointage } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

/**
 * Mode création (agenda) : enregistre la CONFIGURATION d'un créneau — sa capacité et
 * la liste des demandeurs autorisés (vide = ouvert à tous). Remplace l'ensemble des
 * SlotDemandeur du créneau. Fonctionne pour les créneaux récurrents comme ponctuels.
 */
export async function saveSlotConfigAction(input: {
  serviceId: string;
  slotId: string;
  capacity: number;
  demandeurIds: number[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const { serviceId, slotId, capacity, demandeurIds } = input;
  if (!Number.isInteger(capacity) || capacity < 0) {
    return { ok: false, error: "Capacité invalide." };
  }
  const ids = [...new Set(demandeurIds.filter((d) => Number.isInteger(d) && d > 0))];
  try {
    await prisma.$transaction(async (tx) => {
      const slot = await tx.slot.findFirst({ where: { id: slotId, serviceId } });
      if (!slot) throw new Error("Créneau introuvable");
      await tx.slot.update({ where: { id: slotId }, data: { capacity } });
      await tx.slotDemandeur.deleteMany({ where: { slotId } });
      if (ids.length > 0) {
        await tx.slotDemandeur.createMany({
          data: ids.map((demandeurId) => ({ slotId, demandeurId })),
        });
      }
    });
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Mode création (agenda, A/B) : copie les créneaux récurrents d'une semaine vers
 * l'autre (même période). Non destructif (cf. copyRecurringWeek).
 */
export async function copyWeekSlotsAction(input: {
  serviceId: string;
  periodId: number;
  fromWeek: "A" | "B";
  toWeek: "A" | "B";
}): Promise<{ ok: boolean; error?: string; created?: number }> {
  await requireRole("gestionnaire");
  const res = await copyRecurringWeek(
    input.serviceId,
    input.periodId,
    input.fromWeek,
    input.toWeek,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true, created: res.created } : { ok: false, error: res.error };
}

// ─── Mode « Création de créneau » (agenda) ───────────────────────────────────

/**
 * Mode création (agenda) : met à jour la CAPACITÉ PAR DÉFAUT du service — récurrente
 * (`recurCapacity`) ou ponctuelle (`ponctCapacity`). Autosave du champ « Capacité ».
 */
export async function setServiceDefaultCapacityAction(input: {
  serviceId: string;
  kind: "recur" | "ponct";
  value: number;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const value = Math.max(1, Math.floor(input.value));
  if (!Number.isFinite(value)) return { ok: false, error: "Capacité invalide." };
  await prisma.service.update({
    where: { id: input.serviceId },
    data: input.kind === "recur" ? { recurCapacity: value } : { ponctCapacity: value },
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}

/** Pose la liste de demandeurs autorisés sur un créneau (vide = ouvert à tous). */
async function setSlotDemandeurs(slotId: string, demandeurIds: number[] | undefined) {
  const ids = [...new Set((demandeurIds ?? []).filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return;
  await prisma.slotDemandeur.createMany({
    data: ids.map((demandeurId) => ({ slotId, demandeurId })),
  });
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
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  if (!(DAY_KEYS as readonly string[]).includes(input.dayKey)) {
    return { ok: false, error: "Jour invalide." };
  }
  const res = await addRecurringSlot(input.serviceId, input.periodId, {
    startTime: input.startTime,
    endTime: input.endTime,
    weeks: input.weeks,
    dayKey: input.dayKey as DayKeyT,
    capacity: input.capacity,
  });
  if (res.ok) await setSlotDemandeurs(res.id, input.demandeurIds);
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Crée un créneau ponctuel daté (vue Semaine réelle). */
export async function createUniqueSlotAction(input: {
  serviceId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  demandeurIds?: number[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await addUniqueSlot(input.serviceId, {
    slotDate: input.slotDate,
    startTime: input.startTime,
    endTime: input.endTime,
    capacity: input.capacity,
  });
  if (res.ok) await setSlotDemandeurs(res.id, input.demandeurIds);
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
  await requireRole("gestionnaire");
  if (
    !(DAY_KEYS as readonly string[]).includes(input.fromDayKey) ||
    !(DAY_KEYS as readonly string[]).includes(input.toDayKey)
  ) {
    return { ok: false, error: "Jour invalide." };
  }
  const res = await moveRecurringSlot(
    input.serviceId,
    input.slotId,
    input.fromDayKey as DayKeyT,
    input.toDayKey as DayKeyT,
    input.startTime,
    input.endTime,
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
  await requireRole("gestionnaire");
  const res = await moveUniqueSlot(
    input.serviceId,
    input.slotId,
    input.slotDate,
    input.startTime,
    input.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Supprime un créneau (et ses miroirs/réservations) depuis l'agenda. */
export async function deleteSlotAction(
  serviceId: string,
  slotId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await deleteSlots(serviceId, [slotId]);
  revalidatePath(`/services/${serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function deleteBookingAdminAction(bookingId: number, serviceId: string) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.delete({ where: { id: id.data } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

const detailSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  serviceId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(99),
  accompagnants: z.coerce.number().int().min(0).max(99),
  theme: z.string().trim().max(255),
});

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
  await requireRole("gestionnaire");
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  const current = await prisma.booking.findUnique({
    where: { id: d.bookingId },
    select: { pointage: true },
  });
  if (!current) return { ok: false, error: "Réservation introuvable." };
  if (current.pointage != null) {
    return { ok: false, error: "Réservation pointée, non modifiable." };
  }
  await prisma.booking.update({
    where: { id: d.bookingId },
    data: { enfants: d.enfants, accompagnants: d.accompagnants, themeLabel: d.theme },
  });
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}

/** Déplace une réservation vers un autre jour / créneau (glisser-déposer). */
export async function moveBookingAction(
  bookingId: number,
  serviceId: string,
  dayKey: string,
  slotId: string,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({
    where: { id: id.data },
    // auto_validate_from réinitialisé à NOW() sur un déplacement (cf. logique d'origine).
    data: { dayKey, slotId, autoValidateFrom: new Date() },
  });
  revalidatePath(`/services/${serviceId}/agenda`);
}

const createSchema = z.object({
  serviceId: z.string().min(1),
  slotId: z.string().min(1),
  periodId: z.coerce.number().int().positive(),
  dayKey: z.string().min(1),
  userId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
  theme: z.string().trim().max(255).default(""),
  week: z.enum(["", "A", "B"]).default(""),
});

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
  await requireRole("gestionnaire");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  try {
    await prisma.booking.create({
      data: {
        bookingType: "recurring",
        userId: d.userId,
        serviceId: d.serviceId,
        slotId: d.slotId,
        periodId: d.periodId,
        dayKey: d.dayKey,
        week: d.week,
        enfants: d.enfants,
        accompagnants: d.accompagnants,
        themeLabel: d.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}

const createUniqueSchema = z.object({
  serviceId: z.string().min(1),
  slotId: z.string().min(1),
  userId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
  theme: z.string().trim().max(255).default(""),
});

/**
 * Crée une réservation PONCTUELLE (clic sur un créneau ponctuel de l'agenda).
 * Insert direct validé côté admin : pas de contrôle « créneau passé » ni de jauge
 * (le gestionnaire peut réserver n'importe quel créneau), à l'image de
 * `createRecurringBookingAction`. Un ponctuel n'a ni période ni jour : periodId=0,
 * dayKey="" et week="" (cf. modèle Booking / createUniqueBooking).
 */
export async function createUniqueBookingAction(input: {
  serviceId: string;
  slotId: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const parsed = createUniqueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  const slot = await prisma.slot.findUnique({
    where: { id: d.slotId },
    select: { slotType: true, serviceId: true },
  });
  if (!slot || slot.slotType !== "unique" || slot.serviceId !== d.serviceId) {
    return { ok: false, error: "Créneau introuvable." };
  }
  try {
    await prisma.booking.create({
      data: {
        bookingType: "unique",
        userId: d.userId,
        serviceId: d.serviceId,
        slotId: d.slotId,
        periodId: 0,
        dayKey: "",
        week: "",
        enfants: d.enfants,
        accompagnants: d.accompagnants,
        themeLabel: d.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}
