"use server";

import { gaugeUnits } from "@/lib/gauge";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import {
  type BookingConfirmationParams,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import {
  BookingError,
  assertBookingUnlocked,
  assertNotSchoolHolidayForUser,
  assertSlotCapacity,
  cancelUserBooking,
  createUniqueBooking,
  userCanAccessService,
} from "@/server/services/bookings";
import { syncRecurringChildren } from "@/server/services/recurring-children";
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
        // Accès service : le demandeur effectif de l'usager doit accepter ce service.
        if (!(await userCanAccessService(tx, session.user.id, serviceId))) {
          throw new BookingError("Vous n'avez pas accès à ce service.");
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
        const created = await tx.booking.create({
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
        // Matérialise les réservations-enfants datées (une par occurrence).
        await syncRecurringChildren(tx, {
          id: created.id,
          userId: session.user.id,
          serviceId,
          slotId,
          periodId,
          week: wk,
          themeLabel: theme,
          enfants: myEnfants,
          accompagnants: myAcc,
          validated,
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
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, userId: session.user.id, serviceId },
      select: { serviceId: true, validated: true },
    });
    if (!booking) return { ok: false, error: "Réservation introuvable." };
    // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
    await assertBookingUnlocked(prisma, session.user.id, booking);
    await cancelUserBooking(session.user.id, bookingId);
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    throw e;
  }
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
        // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
        await assertBookingUnlocked(tx, session.user.id, booking);
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
        // Vacances scolaires : déplacement vers un créneau PONCTUEL daté en vacances refusé
        // si le service OU le demandeur ferme pendant les vacances (cohérent avec la création).
        if (target.ponctuel && slot.slotDate) {
          await assertNotSchoolHolidayForUser(
            tx,
            session.user.id,
            slot.slotDate,
            slot.service.openOnSchoolHolidays,
          );
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
        if (target.ponctuel) {
          // Devient ponctuelle : plus d'occurrences → on retire d'éventuels enfants.
          await tx.booking.deleteMany({ where: { parentBookingId: bookingId } });
        } else {
          // Récurrente : régénère les enfants sur les nouveaux miroirs.
          await syncRecurringChildren(tx, {
            id: bookingId,
            userId: session.user.id,
            serviceId,
            slotId: target.slotId,
            periodId: target.periodId ?? 0,
            week: wk,
            themeLabel: booking.themeLabel,
            enfants: booking.enfants,
            accompagnants: booking.accompagnants,
            validated,
          });
        }
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

/**
 * Met à jour les compteurs / le thème d'une réservation appartenant à l'usager.
 * Mêmes garde-fous que l'équivalent admin (`updateBookingDetailAction`) : bornes
 * 0–99 / thème 255, miroir non modifiable, réservation pointée refusée, verrou
 * « validation bloquante », et re-vérification de la jauge (anti-surbooking,
 * transaction sérialisable — gonfler les compteurs ne contourne pas la capacité).
 */
export async function updateMyBookingAction(
  serviceId: string,
  bookingId: number,
  enfants: number,
  accompagnants: number,
  theme = "",
): Promise<Result> {
  const session = await requireUser();
  const enf = Math.floor(enfants);
  const acc = Math.floor(accompagnants);
  if (!Number.isInteger(enf) || enf < 0 || enf > 99) {
    return { ok: false, error: "Données invalides." };
  }
  if (!Number.isInteger(acc) || acc < 0 || acc > 99) {
    return { ok: false, error: "Données invalides." };
  }
  const themeLabel = (theme ?? "").trim().slice(0, 255);
  try {
    await prisma.$transaction(
      async (tx) => {
        const b = await tx.booking.findFirst({
          where: { id: bookingId, userId: session.user.id, serviceId },
          select: {
            id: true,
            bookingType: true,
            parentBookingId: true,
            pointage: true,
            userId: true,
            serviceId: true,
            slotId: true,
            periodId: true,
            week: true,
            validated: true,
          },
        });
        if (!b) throw new BookingError("Réservation introuvable.");
        if (b.parentBookingId != null) {
          throw new BookingError("Une séance (miroir) n'est pas modifiable.");
        }
        // Pointée (elle-même ou une de ses séances) → figée, comme l'annulation.
        if (b.pointage != null) throw new BookingError("Réservation pointée, non modifiable.");
        const pointedChildren = await tx.booking.count({
          where: { parentBookingId: b.id, pointage: { not: null } },
        });
        if (pointedChildren > 0) {
          throw new BookingError("Réservation pointée, non modifiable.");
        }
        // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
        await assertBookingUnlocked(tx, session.user.id, b);
        // Anti-surbooking : augmenter les compteurs ne doit pas dépasser la jauge/capacité
        // (la réservation courante est exclue du décompte).
        await assertSlotCapacity(tx, {
          serviceId,
          slotId: b.slotId,
          bookingType: b.bookingType === "recurring" ? "recurring" : "unique",
          periodId: b.periodId,
          enfants: enf,
          accompagnants: acc,
          excludeBookingId: b.id,
        });
        await tx.booking.update({
          where: { id: b.id },
          data: { enfants: enf, accompagnants: acc, themeLabel },
        });
        // Récurrente : propage counts/thème aux réservations-enfants.
        if (b.bookingType === "recurring") {
          await syncRecurringChildren(tx, {
            id: b.id,
            userId: b.userId,
            serviceId: b.serviceId,
            slotId: b.slotId,
            periodId: b.periodId,
            week: b.week,
            themeLabel,
            enfants: enf,
            accompagnants: acc,
            validated: b.validated,
          });
        }
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
  revalidate(serviceId);
  return { ok: true };
}
