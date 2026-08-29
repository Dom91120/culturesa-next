import type { Prisma } from "@/generated/prisma/client";
import type { BookingConfirmationParams } from "@/server/services/booking-mail";
import { BookingError, bookingUserSnapshot } from "@/server/services/bookings";
import { syncRecurringChildren } from "@/server/services/recurring-children";

// ════════════════════════════════════════════════════════════
//  Cœur PARTAGÉ des réservations récurrentes — source unique de l'orchestration
//  dupliquée ×4 avant l'audit 2026-07-24 (création admin, création usager,
//  déplacement admin, déplacement usager) : résolution/validation du créneau
//  cible (anti-injection periodId, dérivation de parité) et insertion
//  (booking.create + matérialisation des enfants + paramètres d'e-mail).
//  Les POLITIQUES restent chez les appelants : gardes usager (accès service,
//  délai, limites, mode validation) côté reservations/actions.ts ; overrides
//  gestionnaire (validée d'emblée, pas de délai → cutoffISO) côté agenda/actions.ts.
// ════════════════════════════════════════════════════════════

/** Parité portée par un créneau (Slot.weeks) : "A"/"B" → cette parité ; tout le
 * reste (null, "", valeur inattendue) → toutes semaines. */
export function slotWeekOf(weeks: string | null | undefined): "" | "A" | "B" {
  return weeks === "A" || weeks === "B" ? weeks : "";
}

/** Créneau récurrent cible résolu et validé, prêt pour l'insertion. */
export type RecurringTarget = {
  slotId: string;
  serviceId: string;
  /** Période du créneau (toujours > 0 — vérifiée à la résolution). */
  periodId: number;
  /** Parité de la réservation, dérivée du créneau (jamais de la valeur cliente). */
  week: "" | "A" | "B";
  /** Restriction SlotDemandeur du créneau (vide = ouvert à tous). */
  demandeurIds: number[];
  // Détail pour l'e-mail de confirmation (lu dans la MÊME transaction).
  serviceLabel: string;
  startTime: string;
  endTime: string;
  slotDay: string | null;
};

/**
 * Résout et VALIDE le créneau récurrent cible d'une création ou d'un déplacement.
 * Refus (BookingError) si : créneau absent ou d'un autre service (anti-IDOR),
 * pas de type récurrent, sans période, ou si la période ANNONCÉE par le client ne
 * correspond pas à celle du créneau. Cette dernière garde est essentielle : la
 * jauge et l'unicité `uq_recurring` sont cloisonnées par {slotId, periodId} — un
 * periodId forgé les contournerait et matérialiserait les occurrences sur la
 * mauvaise plage. La parité de la réservation SUIT le créneau (Slot.weeks), pas
 * la semaine annoncée : un "A" forgé sur un créneau toutes-semaines divisait par
 * deux les occurrences matérialisées (audit 2026-07-19).
 * `periodId` omis (déplacement admin) : la période SUIT le créneau cible.
 */
export async function resolveRecurringTarget(
  tx: Prisma.TransactionClient,
  args: { serviceId: string; slotId: string; periodId?: number },
): Promise<RecurringTarget> {
  const slot = await tx.slot.findFirst({
    where: { id: args.slotId, serviceId: args.serviceId },
    select: {
      slotType: true,
      periodId: true,
      weeks: true,
      startTime: true,
      endTime: true,
      slotDay: true,
      service: { select: { label: true } },
      demandeurs: { select: { demandeurId: true } },
    },
  });
  if (slot?.slotType !== "recurring") {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  // Une réservation récurrente est TOUJOURS rattachée à une période (FK
  // bookings.periodId) : refuse plutôt que de violer la FK.
  if (args.periodId !== undefined && !(args.periodId > 0)) {
    throw new BookingError("Période requise pour une réservation récurrente.");
  }
  if (!(slot.periodId != null && slot.periodId > 0)) {
    throw new BookingError("Période requise pour une réservation récurrente.");
  }
  if (args.periodId !== undefined && slot.periodId !== args.periodId) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  return {
    slotId: args.slotId,
    serviceId: args.serviceId,
    periodId: slot.periodId,
    week: slotWeekOf(slot.weeks),
    demandeurIds: slot.demandeurs.map((d) => d.demandeurId),
    serviceLabel: slot.service.label,
    startTime: slot.startTime,
    endTime: slot.endTime,
    slotDay: slot.slotDay,
  };
}

/**
 * Insère la réservation récurrente sur un créneau RÉSOLU (resolveRecurringTarget)
 * et matérialise ses réservations-enfants datées (une par occurrence). Les gardes
 * (capacité, limites, accès…) doivent avoir été appliquées par l'appelant, DANS la
 * même transaction. Renvoie les paramètres de l'e-mail de confirmation, à envoyer
 * APRÈS le commit (best-effort).
 */
export async function insertRecurringBookingInTx(
  tx: Prisma.TransactionClient,
  target: RecurringTarget,
  params: {
    userId: string;
    theme: string;
    enfants: number;
    accompagnants: number;
    validated: boolean;
    trigger: BookingConfirmationParams["trigger"];
    /** Gestionnaire : pas de délai de réservation — matérialise dès cette date. */
    cutoffISO?: string;
  },
): Promise<BookingConfirmationParams> {
  const created = await tx.booking.create({
    data: {
      bookingType: "recurring",
      userId: params.userId,
      serviceId: target.serviceId,
      slotId: target.slotId,
      periodId: target.periodId,
      week: target.week,
      enfants: params.enfants,
      accompagnants: params.accompagnants,
      themeLabel: params.theme,
      ...(await bookingUserSnapshot(tx, params.userId)),
      validated: params.validated,
      autoValidateFrom: new Date(),
    },
  });
  // La ligne créée EST le ParentForSync (mêmes champs) : plus de payload parallèle
  // à maintenir en phase avec le create.
  await syncRecurringChildren(
    tx,
    created,
    params.cutoffISO !== undefined ? { cutoffISO: params.cutoffISO } : undefined,
  );
  return {
    userId: params.userId,
    serviceId: target.serviceId,
    serviceLabel: target.serviceLabel,
    trigger: params.trigger,
    slot: {
      startTime: target.startTime,
      endTime: target.endTime,
      slotDate: null,
      slotDay: target.slotDay,
    },
    periodId: target.periodId,
    enfants: params.enfants,
    accompagnants: params.accompagnants,
    theme: params.theme,
  };
}
