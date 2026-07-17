"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  bookingCreateSchema,
  hasBothParticipants,
  hasBothParticipantsMsg,
} from "@/schemas/booking";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import {
  type BookingCancellationParams,
  type BookingConfirmationParams,
  sendBookingCancellationMail,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import {
  assertBookingUnlocked,
  assertNotSchoolHolidayForUser,
  assertPeriodOpenForUser,
  assertReservationLimits,
  assertSlotCapacity,
  BookingError,
  cancelUserBookingInTx,
  createUniqueBookingInTx,
  effectiveDemandeurId,
  isValidationMode,
  userCanAccessService,
} from "@/server/services/bookings";
import { openingForDate } from "@/server/services/opening";
import { syncRecurringChildren } from "@/server/services/recurring-children";

function revalidate(serviceId: string) {
  revalidatePath(`/reservations/${serviceId}`);
}

type Result = { ok: boolean; error?: string };

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
  // Une réservation récurrente est TOUJOURS rattachée à une période (FK bookings.periodId).
  // Garde défensif : refuse un periodId absent/invalide plutôt que de violer la FK.
  if (!(periodId > 0)) {
    throw new BookingError("Période requise pour une réservation récurrente.");
  }
  const slot = await tx.slot.findUnique({
    where: { id: slotId },
    include: { service: true, demandeurs: { select: { demandeurId: true } } },
  });
  if (!slot || slot.serviceId !== serviceId || slot.slotType !== "recurring") {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Anti-injection : le periodId DOIT être celui du créneau récurrent. Un periodId
  // forgé (même d'un autre service, du moment qu'il est « dispo ») contournerait
  // sinon la jauge — cloisonnée par {slotId, periodId} (assertSlotCapacity) — et
  // l'unicité uq_recurring, et matérialiserait les enfants sur la mauvaise plage.
  if (slot.periodId !== periodId) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Accès service : le demandeur effectif de l'usager doit accepter ce service.
  if (!(await userCanAccessService(tx, userId, serviceId))) {
    throw new BookingError("Vous n'avez pas accès à ce service.");
  }
  // Disponibilité de la période (colonne « Dispo ») : pas encore ouverte → refus.
  await assertPeriodOpenForUser(tx, periodId);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { enfants: true },
  });
  // Compteurs : valeurs saisies (jauge) si fournies, sinon profil.
  const myEnfants = enfants > 0 ? enfants : (user?.enfants ?? 0);
  const myAcc = accompagnants > 0 ? accompagnants : 0;
  // Une réservation doit compter au moins 1 enfant ET 1 accompagnant (cf.
  // schemas/booking.ts hasBothParticipants) — vérifié ICI sur les valeurs FINALES
  // (après repli sur le profil), le schéma d'entrée reserveRecurringSchema ne voit
  // que les valeurs brutes saisies.
  if (myEnfants < 1 || myAcc < 1) {
    throw new BookingError("Au moins 1 enfant et 1 accompagnant sont requis.");
  }
  // Demandeurs autorisés (SlotDemandeur) : évalués sur le demandeur EFFECTIF (le
  // sien, sinon celui de sa structure) — cohérent avec l'affichage de l'agenda
  // usager. Compte sans demandeur effectif (ex. admin) : autorisé.
  if (slot.demandeurs.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !slot.demandeurs.some((d) => d.demandeurId === demId)) {
      throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
    }
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
  // Limites de réservation de l'usager (max par période + max sur l'exercice, lus
  // sur l'exercice de la période visée).
  await assertReservationLimits(tx, {
    serviceId,
    userId,
    bookingType: "recurring",
    periodId,
  });
  // Validation : validée d'emblée sauf si le demandeur EFFECTIF est en mode validation.
  const validated = !(await isValidationMode(tx, userId, serviceId));
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
    // Création par l'usager : confirmée d'emblée (validation off) ou demande en attente.
    trigger: validated ? "confirm_create" : "pending_create",
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

async function reservePonctuelInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: { slotId: string; theme: string; enfants: number; accompagnants: number },
): Promise<BookingConfirmationParams | null> {
  // Anti-IDOR / cohérence de la validation : le créneau doit appartenir au service
  // annoncé. Sinon `validated` (dérivé de `serviceId`) porterait sur un service
  // autre que celui où la réservation est réellement créée (createUniqueBookingInTx
  // crée sur slot.serviceId) → contournement du mode validation.
  const targetSlot = await tx.slot.findUnique({
    where: { id: args.slotId },
    select: { serviceId: true },
  });
  if (!targetSlot || targetSlot.serviceId !== serviceId) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { enfants: true },
  });
  const validated = !(await isValidationMode(tx, userId, serviceId));
  const myEnfants = args.enfants > 0 ? args.enfants : (user?.enfants ?? 0);
  const myAcc = args.accompagnants > 0 ? args.accompagnants : 0;
  const parsed = bookingCreateSchema.safeParse({
    slotId: args.slotId,
    enfants: myEnfants,
    accompagnants: myAcc,
    themeLabel: args.theme,
  });
  if (!parsed.success) {
    throw new BookingError(parsed.error.issues[0]?.message ?? "Données invalides.");
  }
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
    // Création par l'usager : confirmée d'emblée (validation off) ou demande en attente.
    trigger: validated ? "confirm_create" : "pending_create",
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
    select: {
      serviceId: true,
      validated: true,
      periodId: true,
      slotId: true,
      parentBookingId: true,
    },
  });
  if (!booking) throw new BookingError("Réservation introuvable.");
  // Occurrence ENFANT d'une récurrente : l'annulation porte sur la réservation
  // PARENTE entière (les séances ne s'annulent pas à l'unité côté usager —
  // supprimer un enfant seul laissait toutes les autres occurrences en place).
  if (booking.parentBookingId != null) {
    return cancelInTx(tx, userId, serviceId, booking.parentBookingId);
  }
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
    include: {
      service: true,
      demandeurs: { select: { demandeurId: true } },
      parent: { select: { demandeurs: { select: { demandeurId: true } } } },
    },
  });
  const wantType = target.ponctuel ? "unique" : "recurring";
  if (!slot || slot.serviceId !== serviceId || slot.slotType !== wantType) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Déplacement vers un créneau récurrent → période cible obligatoire (FK bookings.periodId).
  if (!target.ponctuel && !(target.periodId != null && target.periodId > 0)) {
    throw new BookingError("Période requise pour une réservation récurrente.");
  }
  // Anti-injection : vers un récurrent, la période cible DOIT être celle du créneau
  // (même raison qu'à la création : jauge/unicité cloisonnées par periodId).
  if (!target.ponctuel && slot.periodId !== target.periodId) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Demandeurs autorisés (SlotDemandeur) : restriction du créneau, sinon celle de son
  // PARENT pour un miroir (cohérent avec createUniqueBookingInTx — un miroir ne porte
  // pas ses propres lignes SlotDemandeur). Évalué sur le demandeur EFFECTIF (le sien,
  // sinon celui de sa structure). Compte sans demandeur effectif (ex. admin) : autorisé.
  const restriction = slot.demandeurs.length ? slot.demandeurs : (slot.parent?.demandeurs ?? []);
  if (restriction.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !restriction.some((d) => d.demandeurId === demId)) {
      throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
    }
  }
  // Disponibilité de la période CIBLE (colonne « Dispo ») : pas encore ouverte → refus.
  await assertPeriodOpenForUser(tx, target.ponctuel ? slot.periodId : target.periodId);
  // Vacances scolaires : déplacement vers un créneau PONCTUEL daté en vacances refusé
  // si l'exercice couvrant la date visée OU le demandeur ferme pendant les vacances
  // (cohérent avec la création). Date hors de tout exercice = fermée.
  if (target.ponctuel && slot.slotDate) {
    const opening = await openingForDate(tx, serviceId, slot.slotDate.toISOString().slice(0, 10));
    if (!opening) {
      throw new BookingError("Cette date n'est couverte par aucun exercice du service.");
    }
    await assertNotSchoolHolidayForUser(tx, userId, slot.slotDate, opening.openOnSchoolHolidays);
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
  // Limites de réservation de l'usager sur la période CIBLE (max par période + max
  // sur l'exercice) — omises jusqu'ici : un déplacement permettait de dépasser les
  // maxima en créant dans des périodes distinctes puis en regroupant sur une seule.
  // La résa déplacée est exclue du décompte (sinon faux rejet en move intra-exercice).
  await assertReservationLimits(tx, {
    serviceId,
    userId,
    bookingType: target.ponctuel ? "unique" : "recurring",
    periodId: target.ponctuel ? (slot.periodId ?? 0) : (target.periodId ?? 0),
    excludeBookingId: bookingId,
  });
  const validated = !(await isValidationMode(tx, userId, serviceId));
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      slotId: target.slotId,
      // Ponctuel → aucune période (NULL) ; récurrent → période cible (validée plus haut).
      periodId: target.ponctuel ? null : (target.periodId ?? null),
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
  // Au moins 1 enfant ET 1 accompagnant — même invariant qu'à la création (règle
  // partagée), jusqu'ici absent de l'édition : on pouvait ramener une résa à 0/0.
  if (!hasBothParticipants({ enfants: enf, accompagnants: acc })) {
    throw new BookingError(hasBothParticipantsMsg.message);
  }
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
// NON exporté : dans un fichier "use server", tout export devient un endpoint POST
// public — celui-ci prend userId en paramètre et n'a AUCUNE garde (elle est portée
// par commitDraft). Usage strictement interne (audit sécurité 2026-07-17).
async function commitDraftInTx(
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
