import { earliestBookableISO } from "@/lib/booking-delay";
import { toDateInput } from "@/lib/format";
import { gaugeUnits } from "@/lib/gauge";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import type { BookingCreateInput } from "@/schemas/booking";
import { getConfigMany } from "@/server/config";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
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

/**
 * Demandeur EFFECTIF de l'usager : le sien, sinon celui de sa structure (port du
 * `COALESCE(u.demandeur_id, str.demandeur_id)` legacy). `null` = aucun (ex. admin).
 */
export async function effectiveDemandeurId(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<number | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { demandeurId: true, structure: { select: { demandeurId: true } } },
  });
  return u?.demandeurId ?? u?.structure?.demandeurId ?? null;
}

/**
 * L'usager a-t-il accès à ce service ? Accès = son demandeur effectif est référencé
 * dans `service_demandeur_settings`. Sans demandeur effectif (ex. administrateur) →
 * accès libre (voit/réserve tout). Port legacy `require_service_access` (scoping par
 * demandeur via `service_demandeur_settings`).
 */
export async function userCanAccessService(
  db: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
): Promise<boolean> {
  const demId = await effectiveDemandeurId(db, userId);
  if (demId == null) return true;
  const accepts = await db.serviceDemandeurSettings.findFirst({
    where: { serviceId, demandeurId: demId },
    select: { serviceId: true },
  });
  return !!accepts;
}

/**
 * Services réservables PAR L'USAGER courant (avec un aperçu du nombre de créneaux à
 * venir). Un usager ne voit que les services configurés pour SON type de demandeur
 * (présence d'une ligne ServiceDemandeurSettings). Un compte sans demandeur (ex.
 * administrateur) voit tous les services.
 */
export async function listBookableServices() {
  const session = await getSession();
  const userId = session?.user?.id;
  let demandeurId: number | null = null;
  if (userId) {
    // Demandeur effectif (usager direct, sinon celui de sa structure).
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { demandeurId: true, structure: { select: { demandeurId: true } } },
    });
    demandeurId = u?.demandeurId ?? u?.structure?.demandeurId ?? null;
  }
  return prisma.service.findMany({
    where: demandeurId != null ? { demandeurSettings: { some: { demandeurId } } } : undefined,
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

/**
 * Garantit qu'un créneau a la place pour une réservation (anti-surbooking), avec la
 * MÊME règle que la création usager : mode jauge → enfants + adultes (selon
 * `gaugeAccompagnants`) ; hors jauge → 1 par réservation. Lève
 * `BookingError("Ce créneau est complet.")` si la capacité serait dépassée.
 * `excludeBookingId` exclut la réservation en cours (déplacement / édition de
 * compteurs) du décompte. `db` accepte le client global ou un client transactionnel.
 *
 * NB : pour un récurrent, le décompte est scopé par {service, slot, période} — pas par
 * semaine A/B (même périmètre que la création usager ; l'écart A/B est un point distinct).
 */
export async function assertSlotCapacity(
  db: Prisma.TransactionClient,
  params: {
    serviceId: string;
    slotId: string;
    bookingType: "recurring" | "unique";
    periodId: number;
    enfants: number;
    accompagnants: number;
    excludeBookingId?: number;
  },
) {
  const slot = await db.slot.findUnique({
    where: { id: params.slotId },
    select: { capacity: true, service: { select: { capacity: true, gaugeAccompagnants: true } } },
  });
  if (!slot) throw new BookingError("Créneau introuvable.");
  const capacity = slot.capacity ?? slot.service.capacity;
  const gaugeOn = !!(await db.serviceDemandeurSettings.findFirst({
    where: { serviceId: params.serviceId, jauge: true },
    select: { serviceId: true },
  }));
  const occWhere: Prisma.BookingWhereInput =
    params.bookingType === "unique"
      ? { slotId: params.slotId, bookingType: "unique" }
      : { slotId: params.slotId, periodId: params.periodId, bookingType: "recurring" };
  if (params.excludeBookingId != null) occWhere.id = { not: params.excludeBookingId };
  let used: number;
  let mine: number;
  if (gaugeOn) {
    const countAcc = slot.service.gaugeAccompagnants;
    const agg = await db.booking.aggregate({
      where: occWhere,
      _sum: { enfants: true, accompagnants: true },
    });
    used = gaugeUnits(agg._sum.enfants ?? 0, agg._sum.accompagnants ?? 0, countAcc);
    mine = gaugeUnits(params.enfants, params.accompagnants, countAcc);
  } else {
    used = await db.booking.count({ where: occWhere });
    mine = 1;
  }
  if (used + mine > capacity) throw new BookingError("Ce créneau est complet.");
}

/**
 * Vacances scolaires : si le demandeur de l'usager FERME pendant les vacances, refuse un
 * créneau ponctuel daté tombant en vacances scolaires de la zone configurée (port legacy
 * `bk_user_school_block`). No-op si l'usager n'a pas de demandeur (ex. admin) ou s'il est
 * ouvert en vacances. `db` accepte le client global ou un client transactionnel.
 */
export async function assertNotSchoolHolidayForUser(
  db: Prisma.TransactionClient,
  userId: string,
  slotDate: Date,
) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { demandeur: { select: { openOnSchoolHolidays: true } } },
  });
  if (!u?.demandeur || u.demandeur.openOnSchoolHolidays) return;
  const zone = (await getConfigMany(["school.zone"]))["school.zone"] || "A";
  const ranges = (
    await db.schoolHoliday.findMany({
      where: { zone },
      select: { dateStart: true, dateEnd: true },
    })
  ).map((r) => ({ dateStart: toDateInput(r.dateStart), dateEnd: toDateInput(r.dateEnd) }));
  if (isInSchoolHolidayRange(toDateInput(slotDate), ranges)) {
    throw new BookingError("Ce créneau tombe en vacances scolaires.");
  }
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
        // Accès service : le demandeur effectif de l'usager doit accepter ce service.
        if (!(await userCanAccessService(tx, userId, slot.serviceId))) {
          throw new BookingError("Vous n'avez pas accès à ce service.");
        }
        if (!slot.slotDate || slot.slotDate < startOfToday()) {
          throw new BookingError("Ce créneau est passé.");
        }
        // Délai de réservation : la date du créneau doit être ≥ aujourd'hui + délai.
        const earliest = earliestBookableISO(
          slot.service.bookingDelay,
          slot.service.activeDays
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
        );
        if (slot.slotDate.toISOString().slice(0, 10) < earliest) {
          throw new BookingError(
            "Le délai de réservation pour ce créneau n'est pas encore atteint.",
          );
        }

        // Vacances scolaires : demandeur fermé en vacances → créneau ponctuel refusé.
        await assertNotSchoolHolidayForUser(tx, userId, slot.slotDate);

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

/**
 * Annule une réservation appartenant à l'usager. Renvoie true si supprimée.
 * Verrou pointage : une réservation pointée, ou une récurrente dont un miroir est
 * pointé, n'est plus annulable.
 */
export async function cancelUserBooking(userId: string, bookingId: number) {
  const b = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: { pointage: true },
  });
  if (!b) return false;
  if (b.pointage != null) return false;
  const pointedChildren = await prisma.booking.count({
    where: { parentBookingId: bookingId, pointage: { not: null } },
  });
  if (pointedChildren > 0) return false;
  const res = await prisma.booking.deleteMany({ where: { id: bookingId, userId } });
  return res.count > 0;
}

/**
 * Validation bloquante (port du legacy `_blockedDelete = validationMode && validated &&
 * validationBloquante`) : une réservation VALIDÉE est verrouillée — ni annulation ni
 * déplacement possible — lorsque le service est en `validationBloquante` ET que le
 * demandeur de l'usager est en mode validation. Lève `BookingError` si verrouillée.
 * `db` accepte le client global ou un client transactionnel.
 */
export async function assertBookingUnlocked(
  db: Prisma.TransactionClient,
  userId: string,
  booking: { serviceId: string; validated: boolean },
) {
  if (!booking.validated) return;
  const service = await db.service.findUnique({
    where: { id: booking.serviceId },
    select: { validationBloquante: true },
  });
  if (!service?.validationBloquante) return;
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { demandeurId: true },
  });
  if (u?.demandeurId == null) return; // sans demandeur (admin) → pas de mode validation
  const setting = await db.serviceDemandeurSettings.findFirst({
    where: { serviceId: booking.serviceId, demandeurId: u.demandeurId },
    select: { validation: true },
  });
  if (setting?.validation) {
    throw new BookingError("Réservation validée — modification impossible.");
  }
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
  bookingType: string;
  parentBookingId: number | null;
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
      structure: { select: { demandeurId: true } },
      nom: true,
      prenom: true,
      email: true,
      niveau: true,
      enfants: true,
      accompagnants: true,
    },
  });

  // Demandeur effectif : l'usager direct, sinon celui de sa structure (COALESCE legacy).
  const effDemandeurId = user?.demandeurId ?? user?.structure?.demandeurId ?? null;

  // Accès direct : un usager ne peut ouvrir un service que s'il accepte SON type de
  // demandeur (cf. listBookableServices). Compte sans demandeur (ex. admin) : autorisé.
  if (effDemandeurId != null) {
    const accepts = await prisma.serviceDemandeurSettings.findFirst({
      where: { serviceId, demandeurId: effDemandeurId },
      select: { serviceId: true },
    });
    if (!accepts) return null;
  }

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
        bookingType: true,
        parentBookingId: true,
        enfants: true,
        accompagnants: true,
        validated: true,
        pointage: true,
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

  // Modes dérivés du demandeur EFFECTIF de l'usager (repli sur tous si non rattaché).
  const mineSettings =
    effDemandeurId != null ? settings.filter((s) => s.demandeurId === effDemandeurId) : [];
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
      bookingDelay: service.bookingDelay,
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
      validationBloquante: service.validationBloquante,
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
        bookingType: b.bookingType,
        parentBookingId: b.parentBookingId,
        enfants: b.enfants,
        accompagnants: b.accompagnants,
        // Thème réel seulement pour MES réservations (les autres restent anonymes).
        theme: b.userId === userId ? (b.themeLabel ?? "") : "",
        validated: b.validated,
        pointage: b.pointage,
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
