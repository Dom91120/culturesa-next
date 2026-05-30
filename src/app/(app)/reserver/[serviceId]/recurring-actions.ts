"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { BookingError } from "@/server/services/bookings";
import { requireUser } from "@/server/guards";

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/**
 * Réserve un créneau RÉCURRENT pour l'usager (période + jour), avec contrôle de
 * jauge anti-surbooking (transaction sérialisable). La quantité d'enfants est
 * prise dans le profil de l'usager.
 */
export async function bookRecurringAction(
  serviceId: string,
  slotId: string,
  periodId: number,
  dayKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireUser();
  if (!DAY_KEYS.includes(dayKey)) return { ok: false, error: "Jour invalide." };

  try {
    await prisma.$transaction(
      async (tx) => {
        const slot = await tx.slot.findUnique({
          where: { id: slotId },
          include: { service: true, demandeurs: { select: { demandeurId: true } } },
        });
        if (!slot || slot.serviceId !== serviceId || slot.slotType !== "recurring" || slot.state !== "actif") {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        const user = await tx.user.findUnique({
          where: { id: session.user.id },
          select: { enfants: true, demandeurId: true },
        });
        const myEnfants = user?.enfants ?? 0;

        // Restriction par demandeur (liste vide = ouvert à tous).
        if (slot.demandeurs.length > 0 && !slot.demandeurs.some((d) => d.demandeurId === user?.demandeurId)) {
          throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
        }

        const capacity = slot.capacity ?? slot.service.recurCapacity;
        const agg = await tx.booking.aggregate({
          where: { serviceId, slotId, periodId, dayKey, bookingType: "recurring" },
          _sum: { enfants: true },
        });
        const used = agg._sum.enfants ?? 0;
        if (used + myEnfants > capacity) throw new BookingError("Ce créneau est complet.");

        await tx.booking.create({
          data: {
            bookingType: "recurring",
            userId: session.user.id,
            serviceId,
            slotId,
            periodId,
            dayKey,
            week: "",
            enfants: myEnfants,
            validated: false,
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

  revalidatePath(`/reserver/${serviceId}`);
  return { ok: true };
}

/** Annule une réservation récurrente appartenant à l'usager. */
export async function cancelRecurringAction(bookingId: number, serviceId: string) {
  const session = await requireUser();
  await prisma.booking.deleteMany({ where: { id: bookingId, userId: session.user.id } });
  revalidatePath(`/reserver/${serviceId}`);
}
