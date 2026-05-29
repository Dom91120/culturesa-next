import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { BookingCreateInput } from "@/schemas/booking";

/** Erreur métier de réservation (message destiné à l'usager). */
export class BookingError extends Error {}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Services réservables (avec un aperçu du nombre de créneaux à venir). */
export function listBookableServices() {
  return prisma.service.findMany({
    orderBy: [{ position: "asc" }, { label: "asc" }],
    include: {
      _count: {
        select: {
          slots: { where: { state: "actif", slotType: "unique", slotDate: { gte: startOfToday() } } },
        },
      },
    },
  });
}

export type SlotAvailability = {
  id: string;
  slotDate: Date | null;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  remaining: number;
  mine: boolean;
};

/**
 * Service + ses créneaux ponctuels à venir, avec la jauge (places restantes)
 * et l'indication des créneaux déjà réservés par l'usager.
 */
export async function getServiceWithAvailability(serviceId: string, userId: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return null;

  const slots = await prisma.slot.findMany({
    where: {
      serviceId,
      state: "actif",
      slotType: "unique",
      slotDate: { gte: startOfToday() },
    },
    orderBy: [{ slotDate: "asc" }, { startTime: "asc" }],
  });

  const ids = slots.map((s) => s.id);
  const [counts, mine] = await Promise.all([
    prisma.booking.groupBy({ by: ["slotId"], where: { slotId: { in: ids } }, _count: true }),
    prisma.booking.findMany({ where: { userId, slotId: { in: ids } }, select: { slotId: true } }),
  ]);

  const countBySlot = new Map(counts.map((c) => [c.slotId, c._count]));
  const mineSet = new Set(mine.map((b) => b.slotId));

  const availability: SlotAvailability[] = slots.map((s) => {
    const capacity = s.capacity ?? service.ponctCapacity;
    const booked = countBySlot.get(s.id) ?? 0;
    return {
      id: s.id,
      slotDate: s.slotDate,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity,
      booked,
      remaining: Math.max(0, capacity - booked),
      mine: mineSet.has(s.id),
    };
  });

  return { service, availability };
}

/**
 * Crée une réservation pour un créneau ponctuel, en garantissant l'absence de
 * surbooking. La transaction est SÉRIALISABLE : deux réservations concurrentes
 * sur la dernière place en feront échouer une (à réessayer), jamais les deux.
 */
export async function createUniqueBooking(userId: string, input: BookingCreateInput) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const slot = await tx.slot.findUnique({
          where: { id: input.slotId },
          include: { service: true },
        });
        if (!slot || slot.slotType !== "unique" || slot.state !== "actif") {
          throw new BookingError("Ce créneau n'est pas disponible.");
        }
        if (!slot.slotDate || slot.slotDate < startOfToday()) {
          throw new BookingError("Ce créneau est passé.");
        }

        const capacity = slot.capacity ?? slot.service.ponctCapacity;
        const booked = await tx.booking.count({ where: { slotId: slot.id } });
        if (booked >= capacity) {
          throw new BookingError("Ce créneau est complet.");
        }

        return await tx.booking.create({
          data: {
            bookingType: "unique",
            userId,
            serviceId: slot.serviceId,
            slotId: slot.id,
            periodId: 0,
            dayKey: "",
            week: "",
            enfants: input.enfants,
            accompagnants: input.accompagnants,
            themeLabel: input.themeLabel,
            validated: false,
            autoValidateFrom: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) throw e;
    // Violation de l'unicité (uq_recurring) = réservation en double.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BookingError("Vous avez déjà réservé ce créneau.");
    }
    // Échec de sérialisation sous forte concurrence → invite à réessayer.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      throw new BookingError("Réservation simultanée détectée, merci de réessayer.");
    }
    throw e;
  }
}

/** Réservations de l'usager (à venir d'abord). */
export function listUserBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      service: { select: { label: true } },
      slot: { select: { slotDate: true, startTime: true, endTime: true, slotType: true } },
    },
  });
}

/** Annule une réservation appartenant à l'usager. Renvoie true si supprimée. */
export async function cancelUserBooking(userId: string, bookingId: number) {
  const res = await prisma.booking.deleteMany({ where: { id: bookingId, userId } });
  return res.count > 0;
}
