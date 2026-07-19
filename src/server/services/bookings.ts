import { Prisma } from "@/generated/prisma/client";
import { earliestBookableISO, todayParisISO } from "@/lib/booking-delay";
import { toDateInput } from "@/lib/format";
import { gaugeUnits } from "@/lib/gauge";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import type { BookingCreateInput } from "@/schemas/booking";
import { prisma } from "@/server/db";
import { getSession } from "@/server/guards";
import { getSchoolZone, loadSchoolHolidayRanges } from "@/server/services/holidays";
import { openingForDate } from "@/server/services/opening";
import { getServiceDemandeurSettings } from "./demandeur-settings";
import { deriveServiceModes } from "./service-modes";

/** Erreur métier de réservation (message destiné à l'usager). */
export class BookingError extends Error {}

/**
 * Mappe une erreur d'opération de réservation vers `{ ok:false, error }` :
 * BookingError (message métier), P2002 (doublon d'unicité uq_recurring), P2034
 * (conflit de sérialisation). Toute autre erreur est RELANCÉE. Source unique
 * (audit 2026-07-17 : 7 copies aux messages déjà divergents) — messages
 * surchargeables : « Cet usager… » côté admin, « Vous avez… » côté usager.
 */
export function mapBookingError(
  e: unknown,
  msgs?: { duplicate?: string; conflict?: string },
): { ok: false; error: string } {
  if (e instanceof BookingError) return { ok: false, error: e.message };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return { ok: false, error: msgs?.duplicate ?? "Vous avez déjà réservé ce créneau." };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
    return { ok: false, error: msgs?.conflict ?? "Réservation simultanée détectée, réessayez." };
  }
  throw e;
}

/**
 * Minuit UTC du jour calendaire de PARIS — à comparer aux `@db.Date` (stockés à
 * minuit UTC). L'ancienne version prenait minuit dans le fuseau DU SERVEUR :
 * décalage d'un jour possible entre 00h et 02h selon le TZ du process (audit
 * 2026-07-17, standardisation « aujourd'hui = date à Paris »).
 */
function startOfToday(): Date {
  return new Date(`${todayParisISO()}T00:00:00Z`);
}

/**
 * Demandeur EFFECTIF : le sien, sinon celui de sa structure (port du
 * `COALESCE(u.demandeur_id, str.demandeur_id)` legacy). `null` = aucun (ex. admin).
 * Version PURE (usager déjà chargé) — voir `effectiveDemandeurId` pour la version qui
 * requête. Source unique (2 copies inline avant l'audit 2026-07-18).
 */
export function resolveEffectiveDemandeurId(u: {
  demandeurId: number | null;
  structure?: { demandeurId: number | null } | null;
}): number | null {
  return u.demandeurId ?? u.structure?.demandeurId ?? null;
}

/** Demandeur EFFECTIF de l'usager, chargé depuis son id. */
export async function effectiveDemandeurId(
  db: Prisma.TransactionClient,
  userId: string,
): Promise<number | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { demandeurId: true, structure: { select: { demandeurId: true } } },
  });
  return u ? resolveEffectiveDemandeurId(u) : null;
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
 * Contrôles USAGER sur la période visée :
 *   - exercice « Affiché aux utilisateurs » : la période doit appartenir à
 *     l'exercice visible du service (un seul par service, cf. periods.ts) ;
 *   - disponibilité (colonne « Dispo » du panneau Périodes) : refuse tant que la
 *     date d'ouverture n'est pas atteinte. Période sans date (null) ou réservation
 *     sans période : réservable sans restriction.
 * Comparaison en date calendaire de PARIS (le champ est un @db.Date à minuit UTC).
 */
export async function assertPeriodOpenForUser(
  db: Prisma.TransactionClient,
  periodId: number | null | undefined,
) {
  if (!periodId) return;
  const period = await db.period.findUnique({
    where: { id: periodId },
    select: { disponibilite: true, exercice: { select: { visibleToUsers: true } } },
  });
  // Période rattachée à un exercice non affiché aux utilisateurs → hors de portée
  // de la grille usager (la présence dans la grille est déjà filtrée ; ceci ferme
  // la porte aux requêtes forgées).
  if (period?.exercice && !period.exercice.visibleToUsers) {
    throw new BookingError("Cet exercice n'est pas ouvert aux réservations.");
  }
  const dispo = period?.disponibilite;
  if (!dispo) return;
  const dispoIso = dispo.toISOString().slice(0, 10);
  // « Aujourd'hui » = date calendaire à PARIS (et non le fuseau du serveur), comme
  // partout côté serveur (todayParisISO — standardisation audit 2026-07-17).
  const todayIso = todayParisISO();
  if (todayIso < dispoIso) {
    throw new BookingError(
      `Les réservations pour cette période ouvriront le ${dispo.toLocaleDateString("fr-FR", { timeZone: "UTC" })}.`,
    );
  }
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
 * Le demandeur EFFECTIF de l'usager (le sien, sinon celui de sa structure) est-il en
 * mode « validation » pour ce service ? `true` ⇒ la réservation doit rester EN ATTENTE
 * (et la validation bloquante s'applique). `false` (auto-validée) sans demandeur
 * effectif (ex. admin) ou si le réglage est absent/désactivé.
 *
 * SOURCE UNIQUE du mode validation côté serveur (création, déplacement, verrou) —
 * dérivée du demandeur EFFECTIF comme l'affichage de l'agenda usager
 * (deriveServiceModes). Auparavant réimplémentée inline sur `user.demandeurId` DIRECT,
 * ce qui auto-validait et déverrouillait à tort les usagers rattachés à un demandeur
 * via leur seule structure (demandeurId personnel null).
 */
export async function isValidationMode(
  db: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
): Promise<boolean> {
  const demId = await effectiveDemandeurId(db, userId);
  if (demId == null) return false;
  const setting = await db.serviceDemandeurSettings.findFirst({
    where: { serviceId, demandeurId: demId },
    select: { validation: true },
  });
  return setting?.validation ?? false;
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
  const demandeurId = userId ? await effectiveDemandeurId(prisma, userId) : null;
  return prisma.service.findMany({
    where: demandeurId != null ? { demandeurSettings: { some: { demandeurId } } } : undefined,
    orderBy: [{ position: "asc" }, { label: "asc" }],
    include: {
      _count: {
        select: {
          slots: {
            where: { slotType: "unique", slotDate: { gte: startOfToday() } },
          },
        },
      },
    },
  });
}

/**
 * L'usager courant peut-il rencontrer un créneau AVEC jauge ? (au moins un créneau
 * actif `jauge=true` dans un service qui accepte son demandeur effectif). Sert à
 * adapter la présentation (onboarding) : créneau AVEC jauge si vrai, SANS jauge
 * sinon. Compte sans demandeur effectif (ex. admin) → true par défaut
 * (illustration la plus complète).
 */
export async function userHasAnyGauge(): Promise<boolean> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return false;
  const demandeurId = await effectiveDemandeurId(prisma, userId);
  if (demandeurId == null) return true;
  const services = await prisma.serviceDemandeurSettings.findMany({
    where: { demandeurId },
    select: { serviceId: true },
  });
  if (services.length === 0) return false;
  const withGauge = await prisma.slot.findFirst({
    where: {
      serviceId: { in: services.map((s) => s.serviceId) },
      jauge: true,
    },
    select: { id: true },
  });
  return !!withGauge;
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
    // null/0 = aucune période (ponctuel) ; le décompte par période ne concerne que le
    // récurrent — la branche unique ignore periodId.
    periodId: number | null;
    enfants: number;
    accompagnants: number;
    excludeBookingId?: number;
  },
) {
  // Anti-IDOR : le créneau doit appartenir au service annoncé (refuse un slotId
  // pointant vers un autre service que celui couvert par le guard de l'appelant).
  const slot = await db.slot.findFirst({
    where: { id: params.slotId, serviceId: params.serviceId },
    select: {
      capacity: true,
      jauge: true,
      service: { select: { capacity: true, gaugeAccompagnants: true } },
    },
  });
  if (!slot) throw new BookingError("Créneau introuvable.");
  const capacity = slot.capacity ?? slot.service.capacity;
  // « A une jauge » = propriété DU CRÉNEAU (slots.jauge, posée à la création via le
  // mode jauge de l'agenda admin ; miroirs = valeur du parent). Jauge → décompte en
  // unités-jauge (enfants + adultes si comptés) ; sinon « 1 par réservation ».
  const gaugeOn = slot.jauge;
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
 * Limites de réservation USAGER, portées par l'EXERCICE de la période visée :
 *   - `maxReservationsPeriod` : nombre max de réservations de l'usager sur UNE période ;
 *   - `maxReservations` : nombre max sur l'EXERCICE entier (« par an ») — comptées sur
 *     les périodes du MÊME exercice (exact pour les exercices civils comme scolaires,
 *     et remis à zéro à chaque exercice, y compris pour les ponctuelles).
 * Comptées par TYPE : une création récurrente compte les récurrentes ; une ponctuelle
 * compte les ponctuelles STANDALONE (miroirs/enfants exclus). Lève `BookingError` si
 * une limite est atteinte. N'est PAS appliquée aux créations ADMIN (override de gestion).
 * Période sans exercice (legacy) : aucune limite — le flux usager exige de toute façon
 * un exercice (visibilité + ouverture). Doit tourner DANS la transaction de création.
 */
export async function assertReservationLimits(
  db: Prisma.TransactionClient,
  params: {
    serviceId: string;
    userId: string;
    bookingType: "recurring" | "unique";
    // Récurrent : periodId de la réservation ; ponctuel : periodId du SLOT (0 = aucun).
    periodId: number;
    // Réservation à EXCLURE du décompte (déplacement : la résa déplacée ne doit pas
    // se compter elle-même, sinon faux rejet à la limite pour un move intra-exercice).
    excludeBookingId?: number;
  },
) {
  const { serviceId, userId, bookingType, periodId, excludeBookingId } = params;
  if (!(periodId > 0)) return;
  const notSelf = excludeBookingId != null ? { id: { not: excludeBookingId } } : {};
  const period = await db.period.findUnique({
    where: { id: periodId },
    select: {
      exercice: { select: { id: true, maxReservations: true, maxReservationsPeriod: true } },
    },
  });
  const exercice = period?.exercice;
  if (!exercice) return;
  const { maxReservations, maxReservationsPeriod } = exercice;

  const tooManyPeriod = new BookingError("Limite de réservations atteinte pour cette période.");
  const tooManyYear = new BookingError("Limite annuelle de réservations atteinte.");

  // Périmètre « annuel » = toutes les périodes de l'exercice de la période visée.
  const exoPeriods = await db.period.findMany({
    where: { exerciceId: exercice.id },
    select: { id: true },
  });
  const exoPeriodIds = exoPeriods.map((p) => p.id);

  if (bookingType === "recurring") {
    // Par période.
    const perPeriod = await db.booking.count({
      where: { serviceId, userId, periodId, bookingType: "recurring", ...notSelf },
    });
    if (perPeriod >= maxReservationsPeriod) throw tooManyPeriod;

    // Sur l'exercice : récurrentes rattachées à l'une de ses périodes.
    const perYear = await db.booking.count({
      where: {
        serviceId,
        userId,
        bookingType: "recurring",
        periodId: { in: exoPeriodIds },
        ...notSelf,
      },
    });
    if (perYear >= maxReservations) throw tooManyYear;
  } else {
    // Ponctuel : on ne compte que les réservations STANDALONE (parentBookingId null),
    // pour ne pas inclure les miroirs/enfants des récurrentes. Comptage via le
    // CRÉNEAU : les ponctuelles stockent periodId null — l'ancien comptage sur
    // booking.periodId ne matchait jamais (limite par période inopérante).
    const perPeriod = await db.booking.count({
      where: {
        serviceId,
        userId,
        bookingType: "unique",
        parentBookingId: null,
        slot: { periodId },
        ...notSelf,
      },
    });
    if (perPeriod >= maxReservationsPeriod) throw tooManyPeriod;

    // Sur l'exercice : ponctuelles standalone dont le CRÉNEAU appartient à l'une de
    // ses périodes (les ponctuelles portent le periodId via leur slot).
    const perYear = await db.booking.count({
      where: {
        serviceId,
        userId,
        bookingType: "unique",
        parentBookingId: null,
        slot: { periodId: { in: exoPeriodIds } },
        ...notSelf,
      },
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
  const ranges = await loadSchoolHolidayRanges(db, await getSchoolZone());
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
 * doit être DÉJÀ validé (bookingCreateSchema) par l'appelant.
 */
export async function createUniqueBookingInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: BookingCreateInput,
  validated: boolean,
) {
  const slot = await tx.slot.findUnique({
    where: { id: input.slotId },
    include: {
      service: true,
      demandeurs: { select: { demandeurId: true } },
      parent: { select: { demandeurs: { select: { demandeurId: true } } } },
    },
  });
  if (slot?.slotType !== "unique") {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Accès service : le demandeur effectif de l'usager doit accepter ce service.
  if (!(await userCanAccessService(tx, userId, slot.serviceId))) {
    throw new BookingError("Vous n'avez pas accès à ce service.");
  }
  // Demandeurs autorisés (SlotDemandeur) : restriction du créneau, sinon celle de
  // son parent pour un miroir. Compte sans demandeur effectif (ex. admin) : autorisé.
  const restriction = slot.demandeurs.length ? slot.demandeurs : (slot.parent?.demandeurs ?? []);
  if (restriction.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !restriction.some((d) => d.demandeurId === demId)) {
      throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
    }
  }
  if (!slot.slotDate || slot.slotDate < startOfToday()) {
    throw new BookingError("Ce créneau est passé.");
  }
  // Disponibilité de la période du créneau (colonne « Dispo ») : pas encore ouverte → refus.
  await assertPeriodOpenForUser(tx, slot.periodId);
  // Réglages d'ouverture de l'exercice couvrant la DATE RÉSERVÉE — aucune
  // couverture = FERMÉ (cf. opening.ts) : jours ouvrés du délai + vacances.
  const opening = await openingForDate(
    tx,
    slot.serviceId,
    slot.slotDate.toISOString().slice(0, 10),
  );
  if (!opening) {
    throw new BookingError("Cette date n'est couverte par aucun exercice du service.");
  }
  // Délai de réservation : la date du créneau doit être ≥ aujourd'hui + délai.
  const earliest = earliestBookableISO(
    slot.service.bookingDelay,
    opening.activeDays
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
  );
  if (slot.slotDate.toISOString().slice(0, 10) < earliest) {
    throw new BookingError("Le délai de réservation pour ce créneau n'est pas encore atteint.");
  }
  // Vacances scolaires : service OU demandeur fermé en vacances → créneau ponctuel refusé.
  await assertNotSchoolHolidayForUser(tx, userId, slot.slotDate, opening.openOnSchoolHolidays);
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
  // Limites de réservation de l'usager (max par période + max sur l'exercice, lus
  // sur l'exercice de la période du SLOT — la réservation ponctuelle stocke periodId null).
  await assertReservationLimits(tx, {
    serviceId: slot.serviceId,
    userId,
    bookingType: "unique",
    periodId: slot.periodId ?? 0,
  });
  return await tx.booking.create({
    data: {
      bookingType: "unique",
      userId,
      serviceId: slot.serviceId,
      slotId: slot.id,
      periodId: null,
      week: "",
      enfants: input.enfants,
      accompagnants: input.accompagnants,
      themeLabel: input.themeLabel,
      validated,
      autoValidateFrom: new Date(),
    },
  });
}

/**
 * Annule une réservation de l'usager dans un `tx` fourni (composable, panier atomique).
 * Renvoie true si supprimée. Verrou pointage : une réservation pointée, ou une
 * récurrente dont un miroir est pointé, n'est plus annulable — cas signalé par une
 * BookingError (et non un `false` silencieux : l'UI affichait « Réservation
 * supprimée » alors que rien n'était supprimé, cf. audit 2026-07-17), comme le fait
 * déjà l'édition (updateInTx).
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
  if (b.pointage != null) {
    throw new BookingError("Réservation pointée, annulation impossible.");
  }
  const pointedChildren = await tx.booking.count({
    where: { parentBookingId: bookingId, pointage: { not: null } },
  });
  if (pointedChildren > 0) {
    throw new BookingError("Une séance de cette réservation est pointée, annulation impossible.");
  }
  const res = await tx.booking.deleteMany({ where: { id: bookingId, userId } });
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
  if (await isValidationMode(db, userId, booking.serviceId)) {
    throw new BookingError("Réservation validée — modification impossible.");
  }
}

// ─── Agenda usager (onglet « Réservations ») ───────────────────────────────
// Données de l'agenda hebdomadaire d'un service POUR un usager : même forme que
// l'agenda admin (service, périodes, créneaux, modes), mais les réservations sont
// ANONYMISÉES (uniquement enfants/validated pour la jauge) + un drapeau `mine`
// et l'id de la résa propre (pour badge ✅/⏳ et annulation). Les `modes`
// validation/thèmes sont dérivés du demandeur DE L'USAGER (cf. legacy _userDem) ;
// récurrent et A/B sont toujours disponibles, réglés créneau par créneau (Slot.weeks).
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
      enfants: true,
      accompagnants: true,
    },
  });

  const effDemandeurId = user ? resolveEffectiveDemandeurId(user) : null;

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
    disponibilite: true,
    exerciceId: true,
  } as const;

  // Exercice « Affiché aux utilisateurs » : l'UNIQUE exercice du service accessible
  // côté usager (case du panneau Périodes). Service avec exercices mais aucun coché
  // → aucune période visible ; service SANS exercice → comportement historique
  // (périodes actives du service, sinon les globales).
  const [visibleExo, exoCount] = await Promise.all([
    prisma.exercice.findFirst({
      where: { serviceId, visibleToUsers: true },
      // Maximums de réservation : portés par l'exercice (affichés dans le bandeau
      // « Vous pouvez réserver … » de la grille usager).
      select: { id: true, maxReservations: true, maxReservationsPeriod: true },
    }),
    prisma.exercice.count({ where: { serviceId } }),
  ]);

  // Périodes : chargées AVANT les créneaux/réservations (borne de chargement).
  // Exercice visible → ses périodes (cocher un exercice, même passé, suffit à le
  // montrer aux usagers). Service avec exercices mais aucun visible → rien.
  // Service sans exercice → toutes ses périodes.
  const periods = visibleExo
    ? await prisma.period.findMany({
        where: { serviceId, exerciceId: visibleExo.id },
        orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: periodSelect,
      })
    : exoCount > 0
      ? []
      : await prisma.period.findMany({
          where: { serviceId },
          orderBy: [{ dateStart: { sort: "asc", nulls: "last" } }, { id: "asc" }],
          select: periodSelect,
        });
  // Borne de chargement : UNIQUEMENT les créneaux/réservations des périodes actives
  // affichées. Sans elle, l'agenda usager chargeait tous les exercices accumulés
  // — payload re-fetché par chaque tick d'auto-rafraîchissement (audit perf).
  const periodIds = periods.map((p) => p.id);

  const [settings, recurSlots, uniqueSlots, bookings, themeRows] = await Promise.all([
    getServiceDemandeurSettings(serviceId),
    prisma.slot.findMany({
      where: { serviceId, slotType: "recurring", periodId: { in: periodIds } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDay: true,
        periodId: true,
        weeks: true,
        jauge: true,
      },
    }),
    prisma.slot.findMany({
      where: { serviceId, slotType: "unique", periodId: { in: periodIds } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        capacity: true,
        slotDate: true,
        parentSlotId: true,
        periodId: true,
        jauge: true,
      },
    }),
    prisma.booking.findMany({
      // Bornées via leur créneau : seules celles d'un créneau affiché sont rendues.
      where: {
        serviceId,
        bookingType: { in: ["recurring", "unique"] },
        slot: { periodId: { in: periodIds } },
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

  // Créneaux restreints par demandeur (SlotDemandeur) : l'usager ne voit que les
  // créneaux ouverts à tous (aucune ligne) ou autorisés à SON demandeur effectif.
  // Un miroir suit son créneau récurrent parent (les restrictions sont portées par
  // le parent). Compte sans demandeur effectif (ex. admin) : tout est visible.
  // Exception : un créneau où l'usager a DÉJÀ réservé reste visible même si
  // l'admin l'a restreint après coup (sa réservation reste consultable/annulable).
  let visibleRecur = recurSlots;
  let visibleUnique = uniqueSlots;
  let visibleBookings = bookings;
  if (effDemandeurId != null) {
    const allSlotIds = [...recurSlots.map((s) => s.id), ...uniqueSlots.map((s) => s.id)];
    const demRows = allSlotIds.length
      ? await prisma.slotDemandeur.findMany({
          where: { slotId: { in: allSlotIds } },
          select: { slotId: true, demandeurId: true },
        })
      : [];
    const restricted = new Map<string, number[]>();
    for (const r of demRows) {
      const list = restricted.get(r.slotId) ?? [];
      list.push(r.demandeurId);
      restricted.set(r.slotId, list);
    }
    const myBookedSlotIds = new Set(
      bookings.filter((b) => b.userId === userId).map((b) => b.slotId),
    );
    const allowed = (slotId: string) => {
      const list = restricted.get(slotId);
      return !list || list.includes(effDemandeurId) || myBookedSlotIds.has(slotId);
    };
    visibleRecur = recurSlots.filter((s) => allowed(s.id));
    const recurVisibleIds = new Set(visibleRecur.map((s) => s.id));
    visibleUnique = uniqueSlots.filter((s) =>
      s.parentSlotId ? recurVisibleIds.has(s.parentSlotId) : allowed(s.id),
    );
    const visibleSlotIds = new Set([...recurVisibleIds, ...visibleUnique.map((s) => s.id)]);
    visibleBookings = bookings.filter((b) => visibleSlotIds.has(b.slotId));
  }

  // Modes : récurrent et A/B sont toujours disponibles (réglés créneau par créneau,
  // Slot.weeks) ; validation/thèmes restent dérivés du demandeur EFFECTIF de l'usager
  // (repli sur tous si non rattaché).
  const mineSettings =
    effDemandeurId != null ? settings.filter((s) => s.demandeurId === effDemandeurId) : [];
  const modes = deriveServiceModes(mineSettings.length ? mineSettings : settings);

  // Vacances scolaires de la zone configurée : sert à filtrer les dates « prédites »
  // d'un créneau récurrent quand le demandeur de l'usager ferme pendant les vacances
  // (port legacy _predictedDatesForCurrentUser / _isSchoolVacance).
  const schoolHolidays = await loadSchoolHolidayRanges(prisma, await getSchoolZone());

  const exerciceIds = [
    ...new Set(periods.map((p) => p.exerciceId).filter((x): x is number => x != null)),
  ];
  const exerciceRows = (
    exerciceIds.length
      ? await prisma.exercice.findMany({
          where: { id: { in: exerciceIds } },
          select: {
            id: true,
            label: true,
            dateStart: true,
            dateEnd: true,
            morningStart: true,
            morningEnd: true,
            afternoonStart: true,
            afternoonEnd: true,
            activeDays: true,
            openOnHolidays: true,
            openOnSchoolHolidays: true,
          },
        })
      : []
  ).sort((a, b) => a.label.localeCompare(b.label));
  // Réglages d'ouverture de chaque exercice (source unique, cf. opening.ts) :
  // la grille les applique à l'exercice couvrant chaque jour affiché.
  const exercices = exerciceRows.map((e) => ({
    id: e.id,
    label: e.label,
    dateStart: toDateInput(e.dateStart),
    dateEnd: toDateInput(e.dateEnd),
    opening: {
      activeDays: e.activeDays,
      openOnHolidays: e.openOnHolidays,
      openOnSchoolHolidays: e.openOnSchoolHolidays,
      morningStart: e.morningStart,
      morningEnd: e.morningEnd,
      afternoonStart: e.afternoonStart,
      afternoonEnd: e.afternoonEnd,
    },
  }));

  return {
    service: {
      id: service.id,
      label: service.label,
      bookingDelay: service.bookingDelay,
      capacity: service.capacity,
      themesMode: service.themesMode,
      // Maximums de l'exercice VISIBLE (portés par l'exercice ; le DTO garde les
      // clés historiques pour la grille). Sans exercice visible : 1/1 (rien n'est
      // réservable de toute façon).
      maxReservations: visibleExo?.maxReservations ?? 1,
      maxReservationsPeriod: visibleExo?.maxReservationsPeriod ?? 1,
      gaugeAccompagnants: service.gaugeAccompagnants,
      validationBloquante: service.validationBloquante,
    },
    periods: periods.map((p) => ({
      id: p.id,
      label: p.label,
      color: p.color,
      dateStart: toDateInput(p.dateStart),
      dateEnd: toDateInput(p.dateEnd),
      // Ouverture des réservations usager ("" = réservable sans restriction).
      disponibilite: toDateInput(p.disponibilite),
      exerciceId: p.exerciceId,
    })),
    slots: visibleRecur.map((s) => ({ ...s, weeks: s.weeks ?? null })),
    uniqueSlots: visibleUnique.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      slotDate: toDateInput(s.slotDate),
      parentSlotId: s.parentSlotId,
      periodId: s.periodId,
      jauge: s.jauge,
    })),
    bookings: visibleBookings.map(
      (b): UserAgendaBooking => ({
        id: b.id,
        slotId: b.slotId,
        // DTO client : convention 0 = aucune période (la grille usager raisonne en number).
        periodId: b.periodId ?? 0,
        week: b.week,
        bookingType: b.bookingType,
        parentBookingId: b.parentBookingId,
        enfants: b.enfants,
        accompagnants: b.accompagnants,
        // Thème réel seulement pour MES réservations (les autres restent anonymes).
        theme: b.userId === userId ? (b.themeLabel ?? "") : "",
        validated: b.validated,
        // Pointage (présence/absence) : donnée personnelle → exposé seulement pour MES
        // réservations. La grille ne lit le pointage que sur `mine` (cf. impression).
        pointage: b.userId === userId ? b.pointage : null,
        mine: b.userId === userId,
      }),
    ),
    modes,
    exercices,
    themes: themeRows.map((t) => t.label),
    // Libellé du demandeur de l'usager (bandeau debug, cf. legacy #dem-info).
    demandeurLabel: user?.demandeur?.label ?? null,
    // Vacances scolaires — part DEMANDEUR EFFECTIF seule : la grille la combine (∧)
    // avec la politique de l'exercice couvrant chaque date. (Il n'y a plus de part
    // « service » : hors exercice, tout est fermé.)
    demandeurOpenOnSchoolHolidays: effectiveOpenOnSchoolHolidays(user),
    // Plages de vacances scolaires (YYYY-MM-DD) de la zone configurée.
    schoolHolidays,
    // Infos usager pour le récapitulatif de la modale de confirmation (legacy).
    user: {
      nom: user?.nom ?? "",
      prenom: user?.prenom ?? "",
      email: user?.email ?? "",
      enfants: user?.enfants ?? 0,
      accompagnants: user?.accompagnants ?? 0,
    },
  };
}
