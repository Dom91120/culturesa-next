import type { Prisma } from "@/generated/prisma/client";
import { isBookingLockedByPointage } from "@/lib/agenda-core";
import { BookingError } from "@/server/services/bookings";

// ════════════════════════════════════════════════════════════
//  Verrou POINTAGE / MIROIR d'une réservation — source unique côté serveur (audit
//  2026-09-17, A2 : la règle vivait dans agenda/actions.ts et était réécrite à la main
//  dans le chemin usager). Le prédicat pur `isBookingLockedByPointage` (lib/agenda-core)
//  reste partagé avec le client ; ici on lui fournit le seul terme calculé en BDD (un
//  miroir pointé) et on porte les MESSAGES, surchargeables par l'appelant (usager vs
//  gestionnaire) sans changer la règle.
//
//  Règles : un MIROIR (enfant, parentBookingId non null) est toujours immuable ; une
//  réservation autonome POINTÉE est verrouillée ; un PARENT récurrent dont un miroir est
//  pointé est verrouillé. Seul le pointage d'un miroir échappe à ce verrou (géré à part).
// ════════════════════════════════════════════════════════════

/** Champs nécessaires au verrou — à étaler dans le `select` de l'appelant. */
export const LOCK_CANDIDATE_SELECT = {
  id: true,
  bookingType: true,
  parentBookingId: true,
  pointage: true,
} as const;

export type LockCandidate = {
  id: number;
  bookingType: string;
  parentBookingId: number | null;
  pointage: string | null;
};

/** Cause du verrou : miroir, réservation elle-même pointée, ou une de ses séances pointée. */
export type PointageLockReason = "miroir" | "pointage" | "seance";

/** Messages par cause ; `undefined` = message gestionnaire par défaut. */
export type LockMessages = Partial<Record<PointageLockReason, string>>;

export const MESSAGE_VERROU_POINTAGE = "Réservation verrouillée (séance pointée ou miroir).";

/** Un parent récurrent a-t-il au moins un miroir (enfant) POINTÉ ? → il devient immuable. */
export async function parentLockedByPointage(
  db: Prisma.TransactionClient,
  parentId: number,
): Promise<boolean> {
  return (
    (await db.booking.count({
      where: { parentBookingId: parentId, pointage: { not: null } },
    })) > 0
  );
}

/**
 * Cause du verrou d'une réservation déjà lue, `null` si elle est libre. Le miroir pointé
 * n'est cherché que pour un PARENT récurrent (un ponctuel n'a pas d'enfants).
 */
export async function pointageLockReason(
  db: Prisma.TransactionClient,
  b: LockCandidate,
): Promise<PointageLockReason | null> {
  const hasPointedChild = b.bookingType === "recurring" && (await parentLockedByPointage(db, b.id));
  if (!isBookingLockedByPointage(b, hasPointedChild)) return null;
  if (b.parentBookingId != null) return "miroir";
  return b.pointage != null ? "pointage" : "seance";
}

/**
 * Une réservation est-elle verrouillée pour toute action de gestion (supprimer, modifier,
 * déplacer, copier, valider) ? `db` = client global (pré-contrôle, message rapide) ou
 * transactionnel.
 */
export async function bookingLocked(
  db: Prisma.TransactionClient,
  b: LockCandidate,
): Promise<boolean> {
  return (await pointageLockReason(db, b)) != null;
}

/**
 * Lève BookingError si la réservation (déjà lue dans `db`) est verrouillée. Messages
 * surchargeables par cause — le chemin usager garde ainsi ses formulations (« Une séance
 * (miroir) n'est pas modifiable. » / « Réservation pointée, non modifiable. »).
 */
export async function assertNotLockedByPointage(
  db: Prisma.TransactionClient,
  b: LockCandidate,
  messages?: LockMessages,
): Promise<void> {
  const reason = await pointageLockReason(db, b);
  if (reason) throw new BookingError(messages?.[reason] ?? MESSAGE_VERROU_POINTAGE);
}

/**
 * Re-vérifie le verrou pointage/miroir DANS la transaction d'écriture (anti-TOCTOU,
 * audit 2026-07-17) : un pointage posé entre la lecture hors transaction et l'écriture
 * ne passe plus inaperçu. Le pré-contrôle hors transaction reste utile (message rapide),
 * mais c'est CETTE vérification qui fait foi. Anti-IDOR : lecture bornée au service.
 * (Ex-`assertBookingUnlockedInTx`, renommée — audit 2026-07-24 — pour ne plus être
 * quasi homonyme de `bookings.assertBookingUnlocked`, le verrou VALIDATION bloquante.)
 */
export async function assertNotLockedByPointageInTx(
  tx: Prisma.TransactionClient,
  bookingId: number,
  serviceId: string,
  messages?: LockMessages,
): Promise<void> {
  const b = await tx.booking.findFirst({
    where: { id: bookingId, serviceId },
    select: LOCK_CANDIDATE_SELECT,
  });
  if (!b) throw new BookingError("Réservation introuvable.");
  await assertNotLockedByPointage(tx, b, messages);
}
