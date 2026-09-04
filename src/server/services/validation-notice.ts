import { getConfigMany, setConfig } from "@/server/config";
import { prisma } from "@/server/db";
import {
  type BookingConfirmationParams,
  sendBookingConfirmationMailsBatch,
} from "@/server/services/booking-mail";

// ─── Notification DIFFÉRÉE des (dé)validations manuelles ─────────────────────
// Un gestionnaire qui hésite peut enchaîner validé → dévalidé → validé… en quelques
// clics ; envoyer un e-mail à chaque bascule noyait l'usager sous des messages
// contradictoires (retour Dom 2026-09-04). Principe : au clic, on n'envoie rien ; on
// mémorise sur la réservation l'état que l'usager CONNAÎT (celui d'avant le premier
// clic de la fenêtre) et une échéance, réarmée à chaque clic. Le cron
// (/api/cron/validation-notice, toutes les 5 min) traite les échéances atteintes :
// si l'état courant diffère de l'état connu → UN e-mail (« confirmée » ou « remise en
// attente ») reflétant l'état FINAL ; s'il est revenu à l'état connu → rien.
// Délai réglable (Administration › Échanges), 0 = envoi immédiat (comportement
// historique). L'auto-validation, le refus et la suppression restent immédiats.

/** Clé app_config du délai (minutes) ; 0 = immédiat. */
export const VALIDATION_NOTICE_DELAY_KEY = "mail.validationNoticeDelayMinutes";
export const DEFAULT_VALIDATION_NOTICE_DELAY = 5;
export const MAX_VALIDATION_NOTICE_DELAY = 1440;

/** Délai de regroupement configuré (minutes, entier 0..1440 ; défaut 5). */
export async function getValidationNoticeDelay(): Promise<number> {
  const cfg = await getConfigMany([VALIDATION_NOTICE_DELAY_KEY]);
  const raw = cfg[VALIDATION_NOTICE_DELAY_KEY];
  if (raw == null || raw === "") return DEFAULT_VALIDATION_NOTICE_DELAY;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= MAX_VALIDATION_NOTICE_DELAY
    ? n
    : DEFAULT_VALIDATION_NOTICE_DELAY;
}

export async function setValidationNoticeDelay(minutes: number): Promise<void> {
  await setConfig(VALIDATION_NOTICE_DELAY_KEY, String(minutes));
}

/** Champs de la fenêtre de notification portés par la réservation. */
export type ValidationNoticeState = {
  validated: boolean;
  validationNoticeFrom: boolean | null;
  validationNoticeDueAt: Date | null;
};

/**
 * Données d'écriture au clic du gestionnaire (pure) : ouvre une fenêtre — l'état connu
 * de l'usager est celui d'AVANT ce clic — ou, si une fenêtre est déjà ouverte, ne fait
 * que repousser son échéance (l'état connu reste celui du tout premier clic).
 */
export function validationNoticeWindow(
  prev: ValidationNoticeState,
  now: Date,
  delayMinutes: number,
): { validationNoticeFrom: boolean; validationNoticeDueAt: Date } {
  const open = prev.validationNoticeDueAt != null && prev.validationNoticeFrom != null;
  return {
    validationNoticeFrom: open ? (prev.validationNoticeFrom as boolean) : prev.validated,
    validationNoticeDueAt: new Date(now.getTime() + delayMinutes * 60_000),
  };
}

/**
 * À l'échéance (pure) : déclencheur de l'e-mail à envoyer selon l'état final, ou null si
 * la réservation est revenue à l'état que l'usager connaît déjà.
 */
export function resolveValidationNotice(
  from: boolean | null,
  current: boolean,
): "confirm_validate" | "unvalidate" | null {
  if (from === current) return null;
  return current ? "confirm_validate" : "unvalidate";
}

/**
 * Traite les fenêtres arrivées à échéance : e-mails de l'état FINAL (un lot par
 * déclencheur, anti-N+1 comme l'auto-validation) puis fermeture des fenêtres. Idempotent.
 */
export async function runValidationNotices(
  now: Date = new Date(),
): Promise<{ due: number; sent: number; silent: number }> {
  const due = await prisma.booking.findMany({
    where: { validationNoticeDueAt: { lte: now } },
    select: {
      id: true,
      validated: true,
      validationNoticeFrom: true,
      userId: true,
      serviceId: true,
      periodId: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      service: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  if (due.length === 0) return { due: 0, sent: 0, silent: 0 };

  const confirm: BookingConfirmationParams[] = [];
  const unvalidate: BookingConfirmationParams[] = [];
  for (const b of due) {
    const trigger = resolveValidationNotice(b.validationNoticeFrom, b.validated);
    if (!trigger) continue;
    (trigger === "confirm_validate" ? confirm : unvalidate).push({
      userId: b.userId,
      serviceId: b.serviceId,
      serviceLabel: b.service?.label ?? "",
      trigger,
      slot: b.slot,
      periodId: b.periodId,
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      theme: b.themeLabel ?? "",
    });
  }

  // Fenêtres fermées AVANT l'envoi : un second passage concurrent ne renverrait rien.
  await prisma.booking.updateMany({
    where: { id: { in: due.map((b) => b.id) } },
    data: { validationNoticeFrom: null, validationNoticeDueAt: null },
  });
  await sendBookingConfirmationMailsBatch(confirm);
  await sendBookingConfirmationMailsBatch(unvalidate);

  const sent = confirm.length + unvalidate.length;
  return { due: due.length, sent, silent: due.length - sent };
}
