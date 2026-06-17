"use server";

import { bookingCreateSchema } from "@/schemas/booking";
import { prisma } from "@/server/db";
import { isServiceManager, requireUser } from "@/server/guards";
import {
  type BookingCancellationParams,
  type BookingConfirmationParams,
  sendBookingCancellationMail,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import {
  BookingError,
  assertBookingUnlocked,
  assertNotSchoolHolidayForUser,
  assertReservationLimits,
  assertSlotCapacity,
  cancelUserBookingInTx,
  createUniqueBookingInTx,
  userCanAccessService,
} from "@/server/services/bookings";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import { syncRecurringChildren } from "@/server/services/recurring-children";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function revalidate(serviceId: string) {
  revalidatePath(`/reservations/${serviceId}`);
}

/**
 * Sessions datées (occurrences) du service sur [fromYmd, toYmd], avec leurs participants
 * nominatifs — pour l'impression « tous usagers » côté gestionnaire. RÉSERVÉ aux
 * gestionnaires du service (données personnelles des autres usagers) ; un usager normal
 * reçoit `{ ok: false }`.
 */
export async function listServiceSessionsAction(
  serviceId: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ ok: true; sessions: DatedSession[] } | { ok: false; error: string }> {
  const session = await requireUser();
  const role = (session.user as { role?: "utilisateur" | "gestionnaire" | "administrateur" }).role;
  if (!(await isServiceManager(serviceId, session.user.id, role))) {
    return { ok: false, error: "Accès réservé aux gestionnaires du service." };
  }
  const sessions = await listDatedSessions(serviceId, fromYmd, toYmd);
  return { ok: true, sessions };
}

type Result = { ok: boolean; error?: string };

// Validation runtime des entrées de réservation récurrente (bornes compteurs,
// thème ≤ 255) : ces server actions sont appelables avec des valeurs arbitraires,
// le type TypeScript seul ne protège pas (audit architecture).
const reserveRecurringSchema = z.object({
  slotId: z.string().trim().min(1),
  periodId: z.coerce.number().int().positive(),
  theme: z.string().trim().max(255).default(""),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
});

/** Mappe une erreur d'opération de réservation vers un `Result` (BookingError +
 * collisions Prisma P2002/P2034). Réutilisé par les actions mono-op et commitDraft. */
function mapBookingError(e: unknown): Result {
  if (e instanceof BookingError) return { ok: false, error: e.message };
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return { ok: false, error: "Vous avez déjà réservé ce créneau." };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
    return { ok: false, error: "Réservation simultanée détectée, réessayez." };
  }
  throw e;
}

// ── Cœurs transactionnels (composables dans UNE tx — panier atomique commitDraft) ──
// Chaque helper exécute validation + écritures d'UNE opération dans le `tx` fourni et
// lève BookingError en cas de refus. Les ADD renvoient les paramètres d'e-mail de
// confirmation (envoyés APRÈS le commit, best-effort).

async function reserveRecurringInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: {
    slotId: string;
    periodId: number;
    theme: string;
    enfants: number;
    accompagnants: number;
    wk: "A" | "B" | "";
  },
): Promise<BookingConfirmationParams> {
  const { slotId, periodId, theme, enfants, accompagnants, wk } = args;
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
  if (!(await userCanAccessService(tx, userId, serviceId))) {
    throw new BookingError("Vous n'avez pas accès à ce service.");
  }
  const user = await tx.user.findUnique({
    where: { id: userId },
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
  // Anti-surbooking : règle canonique partagée (assertSlotCapacity) — jauge =
  // enfants + adultes ; hors jauge = 1 par réservation.
  await assertSlotCapacity(tx, {
    serviceId,
    slotId,
    bookingType: "recurring",
    periodId,
    enfants: myEnfants,
    accompagnants: myAcc,
  });
  // Limites de réservation de l'usager (max par période + max annuel du service).
  await assertReservationLimits(tx, {
    serviceId,
    userId,
    bookingType: "recurring",
    periodId,
    maxReservations: slot.service.maxReservations,
    maxReservationsPeriod: slot.service.maxReservationsPeriod,
  });
  // Validation : validée d'emblée sauf si le demandeur est en mode « validation ».
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
      userId,
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
    userId,
    serviceId,
    slotId,
    periodId,
    week: wk,
    themeLabel: theme,
    enfants: myEnfants,
    accompagnants: myAcc,
    validated,
  });
  return {
    userId,
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
}

/** Réserve un créneau RÉCURRENT pour l'usager (jauge anti-surbooking, sérialisable). */
export async function reserveRecurringAction(
  serviceId: string,
  rawSlotId: string,
  rawPeriodId: number,
  week = "",
  rawTheme = "",
  rawEnfants = 0,
  rawAccompagnants = 0,
): Promise<Result> {
  const parsed = reserveRecurringSchema.safeParse({
    slotId: rawSlotId,
    periodId: rawPeriodId,
    theme: rawTheme,
    enfants: rawEnfants,
    accompagnants: rawAccompagnants,
  });
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const { slotId, periodId, theme, enfants, accompagnants } = parsed.data;
  const session = await requireUser();
  const wk = week === "A" || week === "B" ? week : "";
  let mailParams: BookingConfirmationParams | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        mailParams = await reserveRecurringInTx(tx, session.user.id, serviceId, {
          slotId,
          periodId,
          theme,
          enfants,
          accompagnants,
          wk,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return mapBookingError(e);
  }
  if (mailParams) await sendBookingConfirmationMail(mailParams);
  revalidate(serviceId);
  return { ok: true };
}

async function reservePonctuelInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: { slotId: string; theme: string; enfants: number; accompagnants: number },
): Promise<BookingConfirmationParams | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { enfants: true, demandeurId: true },
  });
  const setting = user?.demandeurId
    ? await tx.serviceDemandeurSettings.findFirst({
        where: { serviceId, demandeurId: user.demandeurId },
        select: { validation: true },
      })
    : null;
  const validated = !(setting?.validation ?? false);
  const myEnfants = args.enfants > 0 ? args.enfants : (user?.enfants ?? 0);
  const myAcc = args.accompagnants > 0 ? args.accompagnants : 0;
  const parsed = bookingCreateSchema.safeParse({
    slotId: args.slotId,
    enfants: myEnfants,
    accompagnants: myAcc,
    themeLabel: args.theme,
  });
  if (!parsed.success) throw new BookingError("Données invalides.");
  await createUniqueBookingInTx(tx, userId, parsed.data, validated);
  // Slot pour l'e-mail de confirmation (lu dans la même transaction).
  const slot = await tx.slot.findUnique({
    where: { id: args.slotId },
    select: {
      startTime: true,
      endTime: true,
      slotDate: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (!slot) return null;
  return {
    userId,
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
    theme: args.theme,
  };
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
  let mailParams: BookingConfirmationParams | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        mailParams = await reservePonctuelInTx(tx, session.user.id, serviceId, {
          slotId,
          theme,
          enfants,
          accompagnants,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return mapBookingError(e);
  }
  if (mailParams) await sendBookingConfirmationMail(mailParams);
  revalidate(serviceId);
  return { ok: true };
}

/**
 * Annule une réservation appartenant à l'usager. Renvoie les paramètres de l'e-mail
 * « Réservation annulée » à envoyer APRÈS le commit (best-effort) UNIQUEMENT si la
 * réservation était VALIDÉE et a réellement été supprimée ; sinon `null`.
 */
async function cancelInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
): Promise<BookingCancellationParams | null> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
    select: { serviceId: true, validated: true, periodId: true, slotId: true },
  });
  if (!booking) throw new BookingError("Réservation introuvable.");
  // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
  await assertBookingUnlocked(tx, userId, booking);
  const deleted = await cancelUserBookingInTx(tx, userId, bookingId);
  // E-mail d'annulation seulement pour une résa VALIDÉE effectivement supprimée.
  if (!deleted || !booking.validated) return null;
  return {
    userId,
    serviceId,
    slotId: booking.slotId,
    periodId: booking.periodId,
    motif: "Supprimée par l'utilisateur",
  };
}

export async function cancelMyBookingAction(serviceId: string, bookingId: number): Promise<Result> {
  const session = await requireUser();
  let cancelMail: BookingCancellationParams | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      cancelMail = await cancelInTx(tx, session.user.id, serviceId, bookingId);
    });
  } catch (e) {
    return mapBookingError(e);
  }
  // « Réservation annulée » (best-effort, après commit).
  if (cancelMail) await sendBookingCancellationMail(cancelMail);
  revalidate(serviceId);
  return { ok: true };
}

/**
 * Déplace une réservation « en attente » de l'usager vers un autre créneau de MÊME type
 * (récurrent→récurrent, ponctuel→ponctuel), en conservant son id. La validation repasse
 * « en attente » selon le mode du demandeur (port du legacy `_userOnDrop` + `entry.moved`).
 */
async function moveInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
  target: { slotId: string; ponctuel: boolean; periodId?: number; week?: string },
): Promise<void> {
  const wk = target.week === "A" || target.week === "B" ? target.week : "";
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
  });
  if (!booking) throw new BookingError("Réservation introuvable.");
  // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
  await assertBookingUnlocked(tx, userId, booking);
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
    where: { id: userId },
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
      userId,
      slot.slotDate,
      slot.service.openOnSchoolHolidays,
    );
  }
  // Anti-surbooking : règle canonique partagée (assertSlotCapacity), la réservation
  // déplacée étant exclue du décompte.
  await assertSlotCapacity(tx, {
    serviceId,
    slotId: target.slotId,
    bookingType: target.ponctuel ? "unique" : "recurring",
    periodId: target.ponctuel ? 0 : (target.periodId ?? 0),
    enfants: booking.enfants,
    accompagnants: booking.accompagnants,
    excludeBookingId: bookingId,
  });
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
      userId,
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
}

export async function moveMyBookingAction(
  serviceId: string,
  bookingId: number,
  target: { slotId: string; ponctuel: boolean; periodId?: number; week?: string },
): Promise<Result> {
  const session = await requireUser();
  try {
    await prisma.$transaction((tx) => moveInTx(tx, session.user.id, serviceId, bookingId, target), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (e) {
    return mapBookingError(e);
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
async function updateInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
  rawEnfants: number,
  rawAccompagnants: number,
  rawTheme: string,
): Promise<void> {
  const enf = Math.floor(rawEnfants);
  const acc = Math.floor(rawAccompagnants);
  if (!Number.isInteger(enf) || enf < 0 || enf > 99) throw new BookingError("Données invalides.");
  if (!Number.isInteger(acc) || acc < 0 || acc > 99) throw new BookingError("Données invalides.");
  const themeLabel = (rawTheme ?? "").trim().slice(0, 255);
  const b = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
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
  await assertBookingUnlocked(tx, userId, b);
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
}

export async function updateMyBookingAction(
  serviceId: string,
  bookingId: number,
  enfants: number,
  accompagnants: number,
  theme = "",
): Promise<Result> {
  const session = await requireUser();
  try {
    await prisma.$transaction(
      (tx) => updateInTx(tx, session.user.id, serviceId, bookingId, enfants, accompagnants, theme),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return mapBookingError(e);
  }
  revalidate(serviceId);
  return { ok: true };
}

// ── Panier ATOMIQUE : valide tout le brouillon en UNE transaction (tout ou rien) ──
const draftSchema = z.object({
  removals: z.array(z.coerce.number().int().positive()).default([]),
  updates: z
    .array(
      z.object({
        bookingId: z.coerce.number().int().positive(),
        enfants: z.coerce.number().int(),
        accompagnants: z.coerce.number().int(),
        theme: z.string().default(""),
      }),
    )
    .default([]),
  moves: z
    .array(
      z.object({
        bookingId: z.coerce.number().int().positive(),
        slotId: z.string().trim().min(1),
        ponctuel: z.boolean(),
        periodId: z.coerce.number().int().optional(),
        week: z.string().optional(),
      }),
    )
    .default([]),
  adds: z
    .array(
      z.object({
        ponctuel: z.boolean(),
        slotId: z.string().trim().min(1),
        periodId: z.coerce.number().int().optional(),
        week: z.string().optional(),
        theme: z.string().default(""),
        enfants: z.coerce.number().int().min(0).max(999).default(0),
        accompagnants: z.coerce.number().int().min(0).max(999).default(0),
      }),
    )
    .default([]),
});

/**
 * Enregistre TOUT le brouillon du panier en UNE seule transaction sérialisable :
 * suppressions → modifications → déplacements → ajouts (l'ordre libère des places
 * avant les ajouts). Tout ou rien : si une opération échoue, l'ensemble est annulé
 * et rien n'est appliqué. Les e-mails de confirmation des ajouts partent APRÈS le
 * commit (best-effort), comme pour les actions mono-op.
 */
type ParsedDraft = z.infer<typeof draftSchema>;

/**
 * Cœur transactionnel du panier (composable / testable hors auth) : applique tout le
 * brouillon dans le `tx` fourni, dans l'ordre suppressions → modifications →
 * déplacements → ajouts. Lève à la première erreur (→ rollback de toute la tx).
 * Renvoie les e-mails de confirmation à envoyer après le commit.
 */
export async function commitDraftInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  draft: ParsedDraft,
): Promise<{
  confirmations: BookingConfirmationParams[];
  cancellations: BookingCancellationParams[];
}> {
  const mails: BookingConfirmationParams[] = [];
  const cancellations: BookingCancellationParams[] = [];
  for (const id of draft.removals) {
    const cancel = await cancelInTx(tx, userId, serviceId, id);
    if (cancel) cancellations.push(cancel);
  }
  for (const u of draft.updates) {
    await updateInTx(tx, userId, serviceId, u.bookingId, u.enfants, u.accompagnants, u.theme);
  }
  for (const m of draft.moves) {
    await moveInTx(tx, userId, serviceId, m.bookingId, {
      slotId: m.slotId,
      ponctuel: m.ponctuel,
      periodId: m.periodId,
      week: m.week,
    });
  }
  for (const a of draft.adds) {
    if (a.ponctuel) {
      const mp = await reservePonctuelInTx(tx, userId, serviceId, {
        slotId: a.slotId,
        theme: a.theme,
        enfants: a.enfants,
        accompagnants: a.accompagnants,
      });
      if (mp) mails.push(mp);
    } else {
      mails.push(
        await reserveRecurringInTx(tx, userId, serviceId, {
          slotId: a.slotId,
          periodId: a.periodId ?? 0,
          theme: a.theme,
          enfants: a.enfants,
          accompagnants: a.accompagnants,
          wk: a.week === "A" || a.week === "B" ? a.week : "",
        }),
      );
    }
  }
  return { confirmations: mails, cancellations };
}

export async function commitDraft(serviceId: string, rawDraft: unknown): Promise<Result> {
  const session = await requireUser();
  const parsed = draftSchema.safeParse(rawDraft);
  if (!parsed.success) return { ok: false, error: "Brouillon invalide." };
  let confirmations: BookingConfirmationParams[] = [];
  let cancellations: BookingCancellationParams[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        const res = await commitDraftInTx(tx, session.user.id, serviceId, parsed.data);
        confirmations = res.confirmations;
        cancellations = res.cancellations;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return mapBookingError(e);
  }
  // Notifications best-effort, après commit : confirmations d'ajout + annulations de résas validées.
  for (const m of confirmations) await sendBookingConfirmationMail(m);
  for (const c of cancellations) await sendBookingCancellationMail(c);
  revalidate(serviceId);
  return { ok: true };
}
