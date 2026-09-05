import type { Prisma } from "@/generated/prisma/client";
import { bookingCreateSchema } from "@/schemas/booking";
import type { BookingConfirmationParams } from "@/server/services/booking-mail";
import {
  assertPeriodOpenForUser,
  assertReservationLimits,
  assertSlotCapacity,
  assertThemeIfRequired,
  BookingError,
  createUniqueBookingInTx,
  effectiveDemandeurId,
  isValidationMode,
  userCanAccessService,
} from "@/server/services/bookings";
import {
  insertRecurringBookingInTx,
  resolveRecurringTarget,
} from "@/server/services/recurring-booking";

// ─── Cœurs transactionnels de RÉSERVATION par l'usager ──────────────────────────
// Extraits du fichier d'actions de l'agenda usager (2026-09-05) pour être partagés
// avec la liste d'attente (services/waiting-list : contrôle « réservable ? » en
// transaction annulée, puis inscription automatique). Chaque helper exécute
// validation + écritures d'UNE opération dans le `tx` fourni et lève BookingError en
// cas de refus ; il renvoie les paramètres de l'e-mail de confirmation (à envoyer
// APRÈS le commit, best-effort). AUCUNE garde d'authentification ici : c'est
// l'appelant (action serveur, cron) qui porte l'identité et les droits.

export async function reserveRecurringInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: {
    slotId: string;
    periodId: number;
    theme: string;
    enfants: number;
    accompagnants: number;
    // `wk` (parité annoncée) n'est plus utilisé : la parité de la réservation est dérivée
    // du créneau (Slot.weeks). Conservé pour compat des appelants.
    wk?: "A" | "B" | "";
  },
): Promise<BookingConfirmationParams> {
  const { slotId, periodId, theme, enfants, accompagnants } = args;
  // Résolution/validation du créneau cible : type récurrent, service, période
  // annoncée obligatoire et ÉGALE à celle du créneau (anti-injection : jauge et
  // unicité uq_recurring cloisonnées par {slotId, periodId}), parité dérivée du
  // créneau — source unique partagée avec l'agenda admin (recurring-booking.ts).
  const target = await resolveRecurringTarget(tx, { serviceId, slotId, periodId });
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
  if (target.demandeurIds.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !target.demandeurIds.includes(demId)) {
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
    periodId,
  });
  // Thème obligatoire (réglage du demandeur EFFECTIF) : refus si la saisie est vide.
  // Le formulaire l'annonce déjà, mais c'est ICI que la règle est tenue.
  await assertThemeIfRequired(tx, userId, serviceId, theme);
  // Validation : validée d'emblée sauf si le demandeur EFFECTIF est en mode validation.
  const validated = !(await isValidationMode(tx, userId, serviceId));
  // Insertion partagée (booking + réservations-enfants + paramètres d'e-mail).
  // Création par l'usager : confirmée d'emblée (validation off) ou demande en attente.
  return insertRecurringBookingInTx(tx, target, {
    userId,
    theme,
    enfants: myEnfants,
    accompagnants: myAcc,
    validated,
    trigger: validated ? "confirm_create" : "pending_create",
  });
}

export async function reservePonctuelInTx(
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
  await assertThemeIfRequired(tx, userId, serviceId, args.theme);
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
