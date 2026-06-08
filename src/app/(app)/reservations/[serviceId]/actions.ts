"use server";

import { gaugeUnits } from "@/lib/gauge";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import {
  type BookingConfirmationParams,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import { BookingError, cancelUserBooking, createUniqueBooking } from "@/server/services/bookings";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

function revalidate(serviceId: string) {
  revalidatePath(`/reservations/${serviceId}`);
}

type Result = { ok: boolean; error?: string };

/** Réserve un créneau RÉCURRENT pour l'usager (jauge anti-surbooking, sérialisable). */
export async function reserveRecurringAction(
  serviceId: string,
  slotId: string,
  periodId: number,
  week = "",
  theme = "",
  enfants = 0,
  accompagnants = 0,
): Promise<Result> {
  const session = await requireUser();
  const wk = week === "A" || week === "B" ? week : "";
  // Données pour l'e-mail de confirmation, capturées dans la transaction (envoi après commit).
  let mailParams: BookingConfirmationParams | null = null;
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
        const capacity = slot.capacity ?? slot.service.capacity;
        // Capacité selon le mode jauge du service (même règle que l'affichage) : jauge =
        // enfants + adultes ; hors jauge = 1 par réservation. Sinon les enfants du PROFIL
        // de l'usager « remplissent » à tort un créneau (faux « complet »).
        const gaugeOn = !!(await tx.serviceDemandeurSettings.findFirst({
          where: { serviceId, jauge: true },
          select: { serviceId: true },
        }));
        const occWhere = {
          serviceId,
          slotId,
          periodId,
          bookingType: "recurring" as const,
        };
        let used: number;
        let mine: number;
        if (gaugeOn) {
          const countAcc = slot.service.gaugeAccompagnants;
          const agg = await tx.booking.aggregate({
            where: occWhere,
            _sum: { enfants: true, accompagnants: true },
          });
          used = gaugeUnits(agg._sum.enfants ?? 0, agg._sum.accompagnants ?? 0, countAcc);
          mine = gaugeUnits(myEnfants, myAcc, countAcc);
        } else {
          used = await tx.booking.count({ where: occWhere });
          mine = 1;
        }
        if (used + mine > capacity) throw new BookingError("Ce créneau est complet.");
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
            week: wk,
            enfants: myEnfants,
            accompagnants: myAcc,
            themeLabel: theme,
            validated,
            autoValidateFrom: new Date(),
          },
        });
        mailParams = {
          userId: session.user.id,
          serviceId,
          serviceLabel: slot.service.label,
          validated,
          slot: {
            startTime: slot.startTime,
            endTime: slot.endTime,
            slotDate: null,
            slotDay: slot.slotDay,
          },
          periodId,
          enfants: myEnfants,
          accompagnants: myAcc,
          theme,
        };
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
  // Confirmation à l'usager (best-effort, après commit).
  if (mailParams) await sendBookingConfirmationMail(mailParams);
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
  const myEnfants = enfants > 0 ? enfants : (user?.enfants ?? 0);
  const myAcc = accompagnants > 0 ? accompagnants : 0;
  try {
    await createUniqueBooking(
      session.user.id,
      { slotId, enfants: myEnfants, accompagnants: myAcc, themeLabel: theme },
      validated,
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
  // Confirmation à l'usager (best-effort, après création).
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    select: {
      startTime: true,
      endTime: true,
      slotDate: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (slot) {
    await sendBookingConfirmationMail({
      userId: session.user.id,
      serviceId,
      serviceLabel: slot.service.label,
      validated,
      slot: {
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotDate: slot.slotDate,
        slotDay: slot.slotDay,
      },
      enfants: myEnfants,
      accompagnants: myAcc,
      theme,
    });
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
  target: { slotId: string; ponctuel: boolean; periodId?: number; week?: string },
): Promise<Result> {
  const session = await requireUser();
  const wk = target.week === "A" || target.week === "B" ? target.week : "";
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
        const capacity = slot.capacity ?? slot.service.capacity;
        // Capacité selon le mode jauge (même règle que l'affichage et que la création) :
        // jauge = enfants + adultes ; hors jauge = 1 par réservation.
        const gaugeOn = !!(await tx.serviceDemandeurSettings.findFirst({
          where: { serviceId, jauge: true },
          select: { serviceId: true },
        }));
        const occWhere = target.ponctuel
          ? {
              serviceId,
              slotId: target.slotId,
              bookingType: "unique" as const,
              id: { not: bookingId },
            }
          : {
              serviceId,
              slotId: target.slotId,
              periodId: target.periodId ?? 0,
              bookingType: "recurring" as const,
              id: { not: bookingId },
            };
        let used: number;
        let mine: number;
        if (gaugeOn) {
          const countAcc = slot.service.gaugeAccompagnants;
          const agg = await tx.booking.aggregate({
            where: occWhere,
            _sum: { enfants: true, accompagnants: true },
          });
          used = gaugeUnits(agg._sum.enfants ?? 0, agg._sum.accompagnants ?? 0, countAcc);
          mine = gaugeUnits(booking.enfants, booking.accompagnants, countAcc);
        } else {
          used = await tx.booking.count({ where: occWhere });
          mine = 1;
        }
        if (used + mine > capacity) throw new BookingError("Ce créneau est complet.");
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
