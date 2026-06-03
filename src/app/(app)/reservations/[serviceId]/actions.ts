"use server";

import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import { BookingError, cancelUserBooking, createUniqueBooking } from "@/server/services/bookings";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

function revalidate(serviceId: string) {
  revalidatePath(`/reservations/${serviceId}`);
}

type Result = { ok: boolean; error?: string };

/** Réserve un créneau RÉCURRENT pour l'usager (jauge anti-surbooking, sérialisable). */
export async function reserveRecurringAction(
  serviceId: string,
  slotId: string,
  periodId: number,
  dayKey: string,
  week = "",
  theme = "",
  enfants = 0,
  accompagnants = 0,
): Promise<Result> {
  const session = await requireUser();
  if (!DAY_KEYS.includes(dayKey)) return { ok: false, error: "Jour invalide." };
  const wk = week === "A" || week === "B" ? week : "";
  try {
    await prisma.$transaction(
      async (tx) => {
        const slot = await tx.slot.findUnique({
          where: { id: slotId },
          include: { service: true, demandeurs: { select: { demandeurId: true } } },
        });
        if (
          !slot ||
          slot.serviceId !== serviceId ||
          slot.slotType !== "recurring" ||
          slot.state !== "actif"
        ) {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        const user = await tx.user.findUnique({
          where: { id: session.user.id },
          select: { enfants: true, demandeurId: true },
        });
        // Compteurs : valeurs saisies (jauge) si fournies, sinon profil.
        const myEnfants = enfants > 0 ? enfants : (user?.enfants ?? 0);
        const myAcc = accompagnants > 0 ? accompagnants : 0;
        if (
          slot.demandeurs.length > 0 &&
          !slot.demandeurs.some((d) => d.demandeurId === user?.demandeurId)
        ) {
          throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
        }
        const capacity = slot.capacity ?? slot.service.recurCapacity;
        const agg = await tx.booking.aggregate({
          where: { serviceId, slotId, periodId, dayKey, bookingType: "recurring" },
          _sum: { enfants: true },
        });
        const used = agg._sum.enfants ?? 0;
        if (used + myEnfants > capacity) throw new BookingError("Ce créneau est complet.");
        // Validation : si le demandeur de l'usager n'est pas en mode « validation »,
        // la réservation est validée d'emblée ; sinon elle reste en attente.
        const setting = user?.demandeurId
          ? await tx.serviceDemandeurSettings.findFirst({
              where: { serviceId, demandeurId: user.demandeurId },
              select: { validation: true },
            })
          : null;
        const validated = !(setting?.validation ?? false);
        await tx.booking.create({
          data: {
            bookingType: "recurring",
            userId: session.user.id,
            serviceId,
            slotId,
            periodId,
            dayKey,
            week: wk,
            enfants: myEnfants,
            accompagnants: myAcc,
            themeLabel: theme,
            validated,
            autoValidateFrom: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Vous avez déjà réservé ce créneau." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, réessayez." };
    }
    throw e;
  }
  revalidate(serviceId);
  return { ok: true };
}

/** Réserve un créneau PONCTUEL (daté) pour l'usager. */
export async function reservePonctuelAction(
  serviceId: string,
  slotId: string,
  theme = "",
  enfants = 0,
  accompagnants = 0,
): Promise<Result> {
  const session = await requireUser();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { enfants: true, demandeurId: true },
  });
  const setting = user?.demandeurId
    ? await prisma.serviceDemandeurSettings.findFirst({
        where: { serviceId, demandeurId: user.demandeurId },
        select: { validation: true },
      })
    : null;
  const validated = !(setting?.validation ?? false);
  try {
    await createUniqueBooking(
      session.user.id,
      {
        slotId,
        enfants: enfants > 0 ? enfants : (user?.enfants ?? 0),
        accompagnants: accompagnants > 0 ? accompagnants : 0,
        themeLabel: theme,
      },
      validated,
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  revalidate(serviceId);
  return { ok: true };
}

/** Annule une réservation appartenant à l'usager. */
export async function cancelMyBookingAction(serviceId: string, bookingId: number): Promise<Result> {
  const session = await requireUser();
  await cancelUserBooking(session.user.id, bookingId);
  revalidate(serviceId);
  return { ok: true };
}

/**
 * Déplace une réservation « en attente » de l'usager vers un autre créneau de MÊME type
 * (récurrent→récurrent, ponctuel→ponctuel), en conservant son id. La validation repasse
 * « en attente » selon le mode du demandeur (port du legacy `_userOnDrop` + `entry.moved`).
 */
export async function moveMyBookingAction(
  serviceId: string,
  bookingId: number,
  target: { slotId: string; ponctuel: boolean; periodId?: number; dayKey?: string; week?: string },
): Promise<Result> {
  const session = await requireUser();
  const wk = target.week === "A" || target.week === "B" ? target.week : "";
  const dayKey = target.ponctuel ? "" : (target.dayKey ?? "");
  if (!target.ponctuel && !DAY_KEYS.includes(dayKey)) return { ok: false, error: "Jour invalide." };
  try {
    await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findFirst({
          where: { id: bookingId, userId: session.user.id, serviceId },
        });
        if (!booking) throw new BookingError("Réservation introuvable.");
        const slot = await tx.slot.findUnique({
          where: { id: target.slotId },
          include: { service: true, demandeurs: { select: { demandeurId: true } } },
        });
        const wantType = target.ponctuel ? "unique" : "recurring";
        if (
          !slot ||
          slot.serviceId !== serviceId ||
          slot.slotType !== wantType ||
          slot.state !== "actif"
        ) {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        const user = await tx.user.findUnique({
          where: { id: session.user.id },
          select: { demandeurId: true },
        });
        if (
          slot.demandeurs.length > 0 &&
          !slot.demandeurs.some((d) => d.demandeurId === user?.demandeurId)
        ) {
          throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
        }
        const capacity = slot.capacity ?? slot.service.recurCapacity;
        const agg = await tx.booking.aggregate({
          where: target.ponctuel
            ? { serviceId, slotId: target.slotId, bookingType: "unique", id: { not: bookingId } }
            : {
                serviceId,
                slotId: target.slotId,
                periodId: target.periodId ?? 0,
                dayKey,
                bookingType: "recurring",
                id: { not: bookingId },
              },
          _sum: { enfants: true },
        });
        const used = agg._sum.enfants ?? 0;
        if (used + booking.enfants > capacity) throw new BookingError("Ce créneau est complet.");
        const setting = user?.demandeurId
          ? await tx.serviceDemandeurSettings.findFirst({
              where: { serviceId, demandeurId: user.demandeurId },
              select: { validation: true },
            })
          : null;
        const validated = !(setting?.validation ?? false);
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            slotId: target.slotId,
            periodId: target.ponctuel ? 0 : (target.periodId ?? 0),
            dayKey,
            week: target.ponctuel ? "" : wk,
            validated,
            autoValidateFrom: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Vous avez déjà réservé ce créneau." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, réessayez." };
    }
    throw e;
  }
  revalidate(serviceId);
  return { ok: true };
}

/** Met à jour les compteurs / le thème d'une réservation appartenant à l'usager. */
export async function updateMyBookingAction(
  serviceId: string,
  bookingId: number,
  enfants: number,
  accompagnants: number,
  theme = "",
): Promise<Result> {
  const session = await requireUser();
  await prisma.booking.updateMany({
    where: { id: bookingId, userId: session.user.id },
    data: {
      enfants: Math.max(0, enfants),
      accompagnants: Math.max(0, accompagnants),
      themeLabel: theme,
    },
  });
  revalidate(serviceId);
  return { ok: true };
}
