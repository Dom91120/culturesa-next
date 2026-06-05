import { toDateInput } from "@/lib/format";
import { gaugeUnits } from "@/lib/gauge";
import type { BookingCreateInput } from "@/schemas/booking";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { Prisma } from "@prisma/client";
import { getServiceDemandeurSettings } from "./demandeur-settings";
import { deriveServiceModes } from "./service-modes";

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
          slots: {
            where: { state: "actif", slotType: "unique", slotDate: { gte: startOfToday() } },
          },
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
    const capacity = s.capacity ?? service.capacity;
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
export async function createUniqueBooking(
  userId: string,
  input: BookingCreateInput,
  validated = false,
) {
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

        const capacity = slot.capacity ?? slot.service.capacity;
        // Capacité selon le mode jauge du service (même règle que l'affichage et les
        // créneaux récurrents) : jauge = enfants + adultes ; hors jauge = 1 par réservation.
        const gaugeOn = !!(await tx.serviceDemandeurSettings.findFirst({
          where: { serviceId: slot.serviceId, jauge: true },
          select: { serviceId: true },
        }));
        let used: number;
        let mine: number;
        if (gaugeOn) {
          const countAcc = slot.service.gaugeAccompagnants;
          const agg = await tx.booking.aggregate({
            where: { slotId: slot.id },
            _sum: { enfants: true, accompagnants: true },
          });
          used = gaugeUnits(agg._sum.enfants ?? 0, agg._sum.accompagnants ?? 0, countAcc);
          mine = gaugeUnits(input.enfants, input.accompagnants, countAcc);
        } else {
          used = await tx.booking.count({ where: { slotId: slot.id } });
          mine = 1;
        }
        if (used + mine > capacity) {
          throw new BookingError("Ce créneau est complet.");
        }

        return await tx.booking.create({
          data: {
            bookingType: "unique",
            userId,
            serviceId: slot.serviceId,
            slotId: slot.id,
            periodId: 0,
            week: "",
            enfants: input.enfants,
            accompagnants: input.accompagnants,
            themeLabel: input.themeLabel,
            validated,
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

// ─── Agenda usager (onglet « Réservations ») ───────────────────────────────
// Données de l'agenda hebdomadaire d'un service POUR un usager : même forme que
// l'agenda admin (service, périodes, créneaux, modes), mais les réservations sont
// ANONYMISÉES (uniquement enfants/validated pour la jauge) + un drapeau `mine`
// et l'id de la résa propre (pour badge ✅/⏳ et annulation). Les `modes` sont
// dérivés du demandeur DE L'USAGER (cf. legacy _userDem), pas de tous.
// Forme alignée sur le type Booking de l'agenda (pour réutiliser le moteur de
// rendu), mais ANONYMISÉE : name/demandeur/structure vides, accompagnants 0,
// theme "", pointage null. `mine` = réservation de l'usager courant.
export type UserAgendaBooking = {
  id: number;
  slotId: string;
  periodId: number;
  week: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  validated: boolean;
  pointage: "present" | "absent" | null;
  name: string;
  demandeur: string;
  structure: string;
  mine: boolean;
};

export async function getUserServiceAgenda(serviceId: string, userId: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      demandeurId: true,
      demandeur: { select: { label: true, openOnSchoolHolidays: true } },
      nom: true,
      prenom: true,
      email: true,
      niveau: true,
      enfants: true,
      accompagnants: true,
    },
  });

  const periodSelect = {
    id: true,
    label: true,
    color: true,
    dateStart: true,
    dateEnd: true,
    exerciceId: true,
  } as const;

  const [settings, recurSlots, uniqueSlots, bookings, themeRows] = await Promise.all([
    getServiceDemandeurSettings(serviceId),
    prisma.slot.findMany({
      where: { serviceId, slotType: "recurring", state: "actif" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDay: true,
        periodId: true,
        weeks: true,
      },
    }),
    prisma.slot.findMany({
      where: { serviceId, slotType: "unique", state: "actif" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDate: true,
        parentSlotId: true,
      },
    }),
    prisma.booking.findMany({
      where: { serviceId, bookingType: { in: ["recurring", "unique"] } },
      select: {
        id: true,
        slotId: true,
        periodId: true,
        week: true,
        enfants: true,
        accompagnants: true,
        validated: true,
        themeLabel: true,
        userId: true,
      },
    }),
    service.themesMode === "liste"
      ? prisma.serviceTheme.findMany({
          where: { serviceId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { label: true },
        })
      : Promise.resolve([] as { label: string }[]),
  ]);

  // Périodes : celles du service, sinon les globales (fallback, comme l'agenda admin).
  let periods = await prisma.period.findMany({
    where: { serviceId, state: "actif" },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: periodSelect,
  });
  if (periods.length === 0) {
    periods = await prisma.period.findMany({
      where: { serviceId: null, state: "actif" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: periodSelect,
    });
  }

  // Modes dérivés du demandeur de l'usager (repli sur tous si non rattaché / absent).
  const mineSettings = user?.demandeurId
    ? settings.filter((s) => s.demandeurId === user.demandeurId)
    : [];
  const modes = deriveServiceModes(mineSettings.length ? mineSettings : settings);

  // Vacances scolaires de la zone configurée : sert à filtrer les dates « prédites »
  // d'un créneau récurrent quand le demandeur de l'usager ferme pendant les vacances
  // (port legacy _predictedDatesForCurrentUser / _isSchoolVacance).
  const schoolZone = (await getConfigMany(["school.zone"]))["school.zone"] || "A";
  const schoolHolidays = (
    await prisma.schoolHoliday.findMany({
      where: { zone: schoolZone },
      select: { dateStart: true, dateEnd: true },
    })
  ).map((h) => ({ dateStart: toDateInput(h.dateStart), dateEnd: toDateInput(h.dateEnd) }));

  const exerciceIds = [
    ...new Set(periods.map((p) => p.exerciceId).filter((x): x is number => x != null)),
  ];
  const exercices = (
    exerciceIds.length
      ? await prisma.exercice.findMany({
          where: { id: { in: exerciceIds } },
          select: { id: true, label: true },
        })
      : []
  ).sort((a, b) => a.label.localeCompare(b.label));

  return {
    service: {
      id: service.id,
      label: service.label,
      activeDays: service.activeDays,
      morningStart: service.morningStart,
      morningEnd: service.morningEnd,
      afternoonStart: service.afternoonStart,
      afternoonEnd: service.afternoonEnd,
      capacity: service.capacity,
      semaineAb: service.semaineAb,
      themesMode: service.themesMode,
      maxReservations: service.maxReservations,
      maxReservationsPeriod: service.maxReservationsPeriod,
      openOnHolidays: service.openOnHolidays,
      showPreviousExercices: service.showPreviousExercices,
      gaugeAccompagnants: service.gaugeAccompagnants,
    },
    periods: periods.map((p) => ({
      id: p.id,
      label: p.label,
      color: p.color,
      dateStart: toDateInput(p.dateStart),
      dateEnd: toDateInput(p.dateEnd),
      exerciceId: p.exerciceId,
    })),
    slots: recurSlots.map((s) => ({ ...s, weeks: s.weeks ?? null })),
    uniqueSlots: uniqueSlots.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      slotDate: toDateInput(s.slotDate),
      parentSlotId: s.parentSlotId,
    })),
    bookings: bookings.map(
      (b): UserAgendaBooking => ({
        id: b.id,
        slotId: b.slotId,
        periodId: b.periodId,
        week: b.week,
        enfants: b.enfants,
        accompagnants: b.accompagnants,
        // Thème réel seulement pour MES réservations (les autres restent anonymes).
        theme: b.userId === userId ? (b.themeLabel ?? "") : "",
        validated: b.validated,
        pointage: null,
        name: "",
        demandeur: "",
        structure: "",
        mine: b.userId === userId,
      }),
    ),
    modes,
    exercices,
    themes: themeRows.map((t) => t.label),
    // Libellé du demandeur de l'usager (bandeau debug, cf. legacy #dem-info).
    demandeurLabel: user?.demandeur?.label ?? null,
    // Demandeur ouvert pendant les vacances scolaires ? (défaut true si non rattaché,
    // comme legacy : `if (!dem || dem.open_on_school_holidays) return mirrorDates`).
    openOnSchoolHolidays: user?.demandeur?.openOnSchoolHolidays ?? true,
    // Plages de vacances scolaires (YYYY-MM-DD) de la zone configurée.
    schoolHolidays,
    // Infos usager pour le récapitulatif de la modale de confirmation (legacy).
    user: {
      nom: user?.nom ?? "",
      prenom: user?.prenom ?? "",
      email: user?.email ?? "",
      niveau: user?.niveau ?? "",
      enfants: user?.enfants ?? 0,
      accompagnants: user?.accompagnants ?? 0,
    },
  };
}
