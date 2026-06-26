import { earliestBookableISO } from "@/lib/booking-delay";
import { toDateInput } from "@/lib/format";
import { gaugeUnits } from "@/lib/gauge";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import { type BookingCreateInput, bookingCreateSchema } from "@/schemas/booking";
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
 * Ouverture vacances scolaires du demandeur EFFECTIF (le sien, sinon celui de sa
 * structure ; défaut « ouvert » si aucun demandeur effectif) — même règle de repli que
 * effectiveDemandeurId. Source unique pour toutes les évaluations « vacances ».
 * L'appelant doit avoir chargé `demandeur.openOnSchoolHolidays` ET
 * `structure.demandeur.openOnSchoolHolidays`.
 */
export function effectiveOpenOnSchoolHolidays(
  user:
    | {
        demandeur?: { openOnSchoolHolidays: boolean } | null;
        structure?: { demandeur?: { openOnSchoolHolidays: boolean } | null } | null;
      }
    | null
    | undefined,
): boolean {
  return (
    user?.demandeur?.openOnSchoolHolidays ??
    user?.structure?.demandeur?.openOnSchoolHolidays ??
    true
  );
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
 * NB : pour un récurrent, le décompte est scopé par {service, slot, période} ; A, B et
 * « toutes semaines » partagent donc un même budget. CHOIX ASSUMÉ (audit 2026-06-16) :
 * conservateur, JAMAIS surbookant (sur une date A, occupation = A + toutes-sem. ≤
 * A + B + toutes-sem. ≤ capacité ; idem B), au prix d'une sous-utilisation possible des
 * parités. Scoper par parité reviendrait à RELÂCHER ce garde-fou (décision produit) — non retenu.
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
  // Anti-IDOR : le créneau doit appartenir au service annoncé (refuse un slotId
  // pointant vers un autre service que celui couvert par le guard de l'appelant).
  const slot = await db.slot.findFirst({
    where: { id: params.slotId, serviceId: params.serviceId },
    select: { capacity: true, service: { select: { capacity: true, gaugeAccompagnants: true } } },
  });
  if (!slot) throw new BookingError("Créneau introuvable.");
  const capacity = slot.capacity ?? slot.service.capacity;
  // Jauge per-MODE (cf. deriveServiceModes : gaugeRec = récurrent ∧ jauge ; gaugePonct =
  // ponctuel ∧ jauge). Le décompte en unités-jauge ne s'applique qu'au mode de CETTE
  // réservation : un service où seuls les demandeurs PONCTUELS ont la jauge ne jauge pas
  // les réservations récurrentes (et inversement) — sinon décompte « 1 par réservation ».
  const gaugeOn = !!(await db.serviceDemandeurSettings.findFirst({
    where: {
      serviceId: params.serviceId,
      jauge: true,
      recurrent: params.bookingType === "recurring",
    },
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
 * 1er septembre de l'ANNÉE SCOLAIRE en cours (port legacy bookings.php :
 * `date('n') >= 9 ? date('Y')-09-01 : (date('Y')-1)-09-01`). Borne de la limite
 * annuelle de réservations.
 */
function schoolYearStart(now: Date): Date {
  // getMonth() 0-indexé : septembre = 8 → mois ≥ 9 (humain) ⇔ getMonth() ≥ 8.
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(Date.UTC(y, 8, 1));
}

/**
 * Limites de réservation USAGER d'un service (port legacy api/bookings.php) :
 *   - `maxReservationsPeriod` : nombre max de réservations de l'usager sur UNE période ;
 *   - `maxReservations` : nombre max sur l'ANNÉE SCOLAIRE en cours.
 * Comptées par TYPE : une création récurrente compte les récurrentes ; une ponctuelle
 * compte les ponctuelles STANDALONE (miroirs/enfants exclus). Lève `BookingError` si
 * une limite est atteinte. N'est PAS appliquée aux créations ADMIN (override de gestion).
 * Doit tourner DANS la transaction de création (mêmes garanties que le legacy).
 */
export async function assertReservationLimits(
  db: Prisma.TransactionClient,
  params: {
    serviceId: string;
    userId: string;
    bookingType: "recurring" | "unique";
    // Récurrent : periodId de la réservation ; ponctuel : periodId du SLOT (0 = aucun).
    periodId: number;
    maxReservations: number;
    maxReservationsPeriod: number;
  },
) {
  const { serviceId, userId, bookingType, periodId, maxReservations, maxReservationsPeriod } =
    params;
  const tooManyPeriod = new BookingError("Limite de réservations atteinte pour cette période.");
  const tooManyYear = new BookingError("Limite annuelle de réservations atteinte.");

  if (bookingType === "recurring") {
    // Par période.
    const perPeriod = await db.booking.count({
      where: { serviceId, userId, periodId, bookingType: "recurring" },
    });
    if (perPeriod >= maxReservationsPeriod) throw tooManyPeriod;

    // Annuelle : récurrentes dont la période démarre dans l'année scolaire en cours
    // (équivalent du JOIN periods + `p.date_start >= yearStart` du legacy).
    const yearPeriods = await db.period.findMany({
      where: { dateStart: { gte: schoolYearStart(new Date()) } },
      select: { id: true },
    });
    const perYear = await db.booking.count({
      where: {
        serviceId,
        userId,
        bookingType: "recurring",
        periodId: { in: yearPeriods.map((p) => p.id) },
      },
    });
    if (perYear >= maxReservations) throw tooManyYear;
  } else {
    // Ponctuel : on ne compte que les réservations STANDALONE (parentBookingId null),
    // pour ne pas inclure les miroirs/enfants des récurrentes.
    if (periodId > 0) {
      const perPeriod = await db.booking.count({
        where: { serviceId, userId, periodId, bookingType: "unique", parentBookingId: null },
      });
      if (perPeriod >= maxReservationsPeriod) throw tooManyPeriod;
    }
    // Annuelle : total des ponctuelles standalone du service (le legacy ne filtre pas
    // l'année pour ce cas — les ponctuelles n'étant pas rattachées à une période datée).
    const perYear = await db.booking.count({
      where: { serviceId, userId, bookingType: "unique", parentBookingId: null },
    });
    if (perYear >= maxReservations) throw tooManyYear;
  }
}

/**
 * Vacances scolaires : refuse un créneau ponctuel daté tombant en vacances scolaires de la
 * zone configurée (port legacy `bk_user_school_block`) dès lors que le SERVICE ferme pendant
 * les vacances (`serviceOpenOnSchoolHolidays` = false) OU que le demandeur de l'usager ferme.
 * No-op si les deux acceptent les vacances. `db` accepte le client global ou transactionnel.
 */
export async function assertNotSchoolHolidayForUser(
  db: Prisma.TransactionClient,
  userId: string,
  slotDate: Date,
  serviceOpenOnSchoolHolidays: boolean,
) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      demandeur: { select: { openOnSchoolHolidays: true } },
      structure: { select: { demandeur: { select: { openOnSchoolHolidays: true } } } },
    },
  });
  const demandeurOpen = effectiveOpenOnSchoolHolidays(u);
  if (serviceOpenOnSchoolHolidays && demandeurOpen) return;
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
/**
 * Cœur transactionnel de la création ponctuelle (validation + anti-surbooking +
 * limites + create), exécuté dans un `tx` fourni. Permet de composer cette opération
 * avec d'autres dans UNE seule transaction (panier atomique `commitDraft`). L'input
 * doit être DÉJÀ validé (cf. `createUniqueBooking`).
 */
export async function createUniqueBookingInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: BookingCreateInput,
  validated: boolean,
) {
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
    throw new BookingError("Le délai de réservation pour ce créneau n'est pas encore atteint.");
  }
  // Vacances scolaires : service OU demandeur fermé en vacances → créneau ponctuel refusé.
  await assertNotSchoolHolidayForUser(tx, userId, slot.slotDate, slot.service.openOnSchoolHolidays);
  // Anti-surbooking : règle canonique partagée (jauge/capacité) — une seule
  // implémentation pour création usager, édition et déplacement admin.
  await assertSlotCapacity(tx, {
    serviceId: slot.serviceId,
    slotId: slot.id,
    bookingType: "unique",
    periodId: 0,
    enfants: input.enfants,
    accompagnants: input.accompagnants,
  });
  // Limites de réservation de l'usager (max par période + max annuel). La période est
  // portée par le SLOT (la réservation ponctuelle stocke periodId=0).
  await assertReservationLimits(tx, {
    serviceId: slot.serviceId,
    userId,
    bookingType: "unique",
    periodId: slot.periodId ?? 0,
    maxReservations: slot.service.maxReservations,
    maxReservationsPeriod: slot.service.maxReservationsPeriod,
  });
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
}

export async function createUniqueBooking(
  userId: string,
  rawInput: BookingCreateInput,
  validated = false,
) {
  // Validation runtime (bornes compteurs, thème ≤ 255) : le type seul ne protège
  // pas une server action des entrées hors bornes (audit architecture).
  const parsedInput = bookingCreateSchema.safeParse(rawInput);
  if (!parsedInput.success) throw new BookingError("Données invalides.");
  const input = parsedInput.data;
  try {
    return await prisma.$transaction(
      (tx) => createUniqueBookingInTx(tx, userId, input, validated),
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

/**
 * Annule une réservation de l'usager dans un `tx` fourni (composable, panier atomique).
 * Renvoie true si supprimée. Verrou pointage : une réservation pointée, ou une
 * récurrente dont un miroir est pointé, n'est plus annulable.
 */
export async function cancelUserBookingInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  bookingId: number,
) {
  const b = await tx.booking.findFirst({
    where: { id: bookingId, userId },
    select: { pointage: true },
  });
  if (!b) return false;
  if (b.pointage != null) return false;
  const pointedChildren = await tx.booking.count({
    where: { parentBookingId: bookingId, pointage: { not: null } },
  });
  if (pointedChildren > 0) return false;
  const res = await tx.booking.deleteMany({ where: { id: bookingId, userId } });
  return res.count > 0;
}

export async function cancelUserBooking(userId: string, bookingId: number) {
  return prisma.$transaction((tx) => cancelUserBookingInTx(tx, userId, bookingId));
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
      structure: {
        select: { demandeurId: true, demandeur: { select: { openOnSchoolHolidays: true } } },
      },
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

  // Périodes : celles du service, sinon les globales (fallback, comme l'agenda admin).
  // Chargées AVANT les créneaux/réservations : elles servent de borne de chargement.
  let periods = await prisma.period.findMany({
    where: { serviceId, state: "actif" },
    orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: periodSelect,
  });
  if (periods.length === 0) {
    periods = await prisma.period.findMany({
      where: { serviceId: null, state: "actif" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: periodSelect,
    });
  }
  // Borne de chargement : UNIQUEMENT les créneaux/réservations des périodes actives
  // affichées. Sans elle, l'agenda usager chargeait tous les exercices accumulés
  // — payload re-fetché par chaque tick d'auto-rafraîchissement (audit perf).
  const periodIds = periods.map((p) => p.id);

  const [settings, recurSlots, uniqueSlots, bookings, themeRows] = await Promise.all([
    getServiceDemandeurSettings(serviceId),
    prisma.slot.findMany({
      where: { serviceId, slotType: "recurring", state: "actif", periodId: { in: periodIds } },
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
      where: { serviceId, slotType: "unique", state: "actif", periodId: { in: periodIds } },
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
      // Bornées via leur créneau : seules celles d'un créneau affiché sont rendues.
      where: {
        serviceId,
        bookingType: { in: ["recurring", "unique"] },
        slot: { state: "actif", periodId: { in: periodIds } },
      },
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
      openOnSchoolHolidays: service.openOnSchoolHolidays,
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
    // Ouvert pendant les vacances scolaires ? Combinaison SERVICE ∧ DEMANDEUR EFFECTIF :
    // il faut que les deux acceptent les vacances pour que les jours de vacances restent
    // réservables. (Demandeur effectif = le sien, sinon celui de sa structure ; défaut true
    // si aucun. Service : défaut false.)
    openOnSchoolHolidays: service.openOnSchoolHolidays && effectiveOpenOnSchoolHolidays(user),
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
