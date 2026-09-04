import { ISO_DAY_KEYS } from "@/lib/agenda-core";
import { parisWallToInstant, toParisWall } from "@/lib/paris-time";
import { prisma } from "@/server/db";
import { sendBookingConfirmationMailsBatch } from "@/server/services/booking-mail";
import {
  DEFAULT_OPENING,
  EXERCICE_OPENING_SELECT,
  type OpeningConfig,
} from "@/server/services/opening";

// ════════════════════════════════════════════════════════════
//  Auto-validation des réservations (port du legacy auto_validate_bookings.php)
//
//  `service.autoValidationDelay` = délai SIGNÉ en minutes :
//    0       → désactivé
//    négatif → N minutes OUVRÉES (jours actifs ∩ plages matin/après-midi)
//    positif → N minutes CALENDAIRES après `booking.autoValidateFrom`
//
//  Une réservation en attente (`validated = false`) est validée quand le délai
//  depuis `autoValidateFrom` est écoulé, sauf si la séance est déjà passée.
// ════════════════════════════════════════════════════════════

// Conversion instant ↔ heure murale Paris (indépendante du fuseau serveur, gestion
// DST) : source unique dans lib/paris-time — les heures ouvrées sont exprimées en
// heure murale FR.

/** Jour de la semaine (0=dim..6=sam) d'une date murale. */
function wallDow(y: number, mo: number, da: number): number {
  return new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
}

function nextWallDay(y: number, mo: number, da: number): { y: number; mo: number; da: number } {
  const d = new Date(Date.UTC(y, mo - 1, da + 1));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, da: d.getUTCDate() };
}

const hhmm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/**
 * Instant atteint après `minutesNeeded` minutes OUVRÉES depuis `from`, selon les
 * jours actifs et les plages matin/après-midi (heure murale Paris). Si `from` est
 * hors plage, le décompte démarre à la prochaine fenêtre utile. Port de
 * `av_business_deadline`.
 */
function businessDeadline(
  from: Date,
  minutesNeeded: number,
  activeDays: string[],
  mStart: string,
  mEnd: string,
  aStart: string,
  aEnd: string,
): Date {
  const mS = hhmm(mStart);
  const mE = hhmm(mEnd);
  const aS = hhmm(aStart);
  const aE = hhmm(aEnd);
  const hasM = mE > mS;
  const hasA = aE > aS;
  let remaining = Math.max(1, minutesNeeded);
  // Plages dégénérées : repli calendaire pour éviter une boucle infinie.
  if (!hasM && !hasA) return new Date(from.getTime() + remaining * 60000);

  let { y, mo, da, min } = toParisWall(from);
  let iter = 366 * 4; // garde-fou (~1 an)
  while (remaining > 0 && iter-- > 0) {
    if (!activeDays.includes(ISO_DAY_KEYS[wallDow(y, mo, da)])) {
      ({ y, mo, da } = nextWallDay(y, mo, da));
      min = 0;
      continue;
    }
    let winStart: number;
    let winEnd: number;
    if (hasM && min < mE) {
      winStart = Math.max(min, mS);
      winEnd = mE;
    } else if (hasA && min < aE) {
      winStart = Math.max(min, aS);
      winEnd = aE;
    } else {
      ({ y, mo, da } = nextWallDay(y, mo, da));
      min = 0;
      continue;
    }
    const avail = winEnd - winStart;
    if (avail <= 0) {
      min = winEnd;
      continue;
    }
    if (remaining <= avail) return parisWallToInstant(y, mo, da, winStart + remaining);
    remaining -= avail;
    min = winEnd;
  }
  // Garde-fou : échéance lointaine plutôt qu'une boucle infinie.
  return new Date(from.getTime() + minutesNeeded * 60000 * 5);
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Valide automatiquement les réservations confirmables et notifie l'usager
 * (e-mail « Réservation confirmée »). Idempotent : ne touche que les réservations
 * encore en attente. Renvoie des compteurs de diagnostic.
 */
export async function runAutoValidation(now: Date = new Date()): Promise<{
  services: number;
  candidates: number;
  validated: number;
  skippedPast: number;
  notYet: number;
}> {
  const stats = { services: 0, candidates: 0, validated: 0, skippedPast: 0, notYet: 0 };
  const todayIso = toIso(now);

  const services = await prisma.service.findMany({
    where: { autoValidationDelay: { not: 0 } },
    select: {
      id: true,
      label: true,
      autoValidationDelay: true,
    },
  });

  // Réservations dues, accumulées sur TOUS les services : validées en UNE transaction
  // (2 updateMany) au lieu d'une transaction par réservation (audit perf — cron
  // séquentiel). Les e-mails (un par usager, incompressible) partent APRÈS le commit,
  // best-effort, comme avant.
  const dueIds: number[] = [];
  const dueRecurringIds: number[] = [];
  const mails: Parameters<typeof sendBookingConfirmationMailsBatch>[0][number][] = [];

  const svcIds = services.map((s) => s.id);

  // Réglages d'ouverture PAR EXERCICE (source unique, cf. opening.ts) : le temps
  // OUVRÉ d'une réservation se compte avec les jours/plages de l'exercice couvrant
  // sa date de départ (autoValidateFrom), repli DEFAULT_OPENING hors exercice —
  // sinon les échéances ouvrées gèleraient.
  const allExercices = svcIds.length
    ? await prisma.exercice.findMany({
        where: { serviceId: { in: svcIds } },
        select: {
          serviceId: true,
          dateStart: true,
          dateEnd: true,
          ...EXERCICE_OPENING_SELECT,
        },
      })
    : [];
  const exercicesByService = new Map<string, typeof allExercices>();
  for (const e of allExercices) {
    if (!e.serviceId) continue;
    const arr = exercicesByService.get(e.serviceId);
    if (arr) arr.push(e);
    else exercicesByService.set(e.serviceId, [e]);
  }
  const openingForFrom = (serviceId: string, from: Date): OpeningConfig => {
    const fromIso = toIso(from);
    const ex = (exercicesByService.get(serviceId) ?? []).find(
      (e) =>
        e.dateStart && e.dateEnd && toIso(e.dateStart) <= fromIso && fromIso <= toIso(e.dateEnd),
    );
    return ex ?? DEFAULT_OPENING;
  };

  // Toutes les réservations candidates de TOUS les services en UNE requête (au lieu
  // d'un findMany par service — audit perf P4 : N+1 sur les services).
  const allCands = svcIds.length
    ? await prisma.booking.findMany({
        where: {
          serviceId: { in: svcIds },
          validated: false,
          parentBookingId: null,
          autoValidateFrom: { not: null },
        },
        select: {
          id: true,
          serviceId: true,
          bookingType: true,
          userId: true,
          periodId: true,
          themeLabel: true,
          enfants: true,
          accompagnants: true,
          autoValidateFrom: true,
          slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
        },
      })
    : [];
  stats.candidates = allCands.length;

  // Fins de période (test « séance passée » des récurrents) — toutes en UNE requête.
  const periodIds = [
    ...new Set(
      allCands
        .filter((c) => c.bookingType === "recurring")
        .map((c) => c.periodId)
        .filter((id): id is number => id != null && id > 0),
    ),
  ];
  const periodEnd = new Map<number, Date | null>(
    periodIds.length
      ? (
          await prisma.period.findMany({
            where: { id: { in: periodIds } },
            select: { id: true, dateEnd: true },
          })
        ).map((p) => [p.id, p.dateEnd])
      : [],
  );

  // Regroupe les candidates par service.
  const candsByService = new Map<string, typeof allCands>();
  for (const c of allCands) {
    const arr = candsByService.get(c.serviceId);
    if (arr) arr.push(c);
    else candsByService.set(c.serviceId, [c]);
  }

  for (const svc of services) {
    stats.services += 1;
    const cands = candsByService.get(svc.id) ?? [];
    if (cands.length === 0) continue;
    const delay = svc.autoValidationDelay;
    const delayMinutes = Math.abs(delay);
    const isBusiness = delay < 0;

    for (const c of cands) {
      // Séance déjà passée → on n'auto-valide pas.
      const past =
        c.bookingType === "unique"
          ? c.slot.slotDate != null && toIso(c.slot.slotDate) < todayIso
          : (() => {
              const end = c.periodId != null ? periodEnd.get(c.periodId) : null;
              return end != null && toIso(end) < todayIso;
            })();
      if (past) {
        stats.skippedPast += 1;
        continue;
      }

      const from = c.autoValidateFrom;
      if (!from) continue;
      // Jours/plages ouvrés de l'exercice couvrant la date de départ de la résa.
      const opening = isBusiness ? openingForFrom(svc.id, from) : null;
      const deadline =
        isBusiness && opening
          ? businessDeadline(
              from,
              delayMinutes,
              opening.activeDays
                .split(",")
                .map((d) => d.trim())
                .filter(Boolean),
              opening.morningStart,
              opening.morningEnd,
              opening.afternoonStart,
              opening.afternoonEnd,
            )
          : new Date(from.getTime() + delayMinutes * 60000);

      if (deadline.getTime() > now.getTime()) {
        stats.notYet += 1;
        continue;
      }

      dueIds.push(c.id);
      // Validation au niveau de la série : les enfants des récurrents suivront.
      if (c.bookingType === "recurring") dueRecurringIds.push(c.id);
      stats.validated += 1;
      // Notification usager : réutilise l'e-mail « Réservation confirmée » (envoyé
      // après le commit, best-effort).
      mails.push({
        userId: c.userId,
        serviceId: svc.id,
        serviceLabel: svc.label,
        trigger: "confirm_autovalidate",
        slot: {
          startTime: c.slot.startTime,
          endTime: c.slot.endTime,
          slotDate: c.slot.slotDate,
          slotDay: c.slot.slotDay,
        },
        periodId: c.periodId,
        enfants: c.enfants,
        accompagnants: c.accompagnants,
        theme: c.themeLabel,
      });
    }
  }

  if (dueIds.length > 0) {
    await prisma.$transaction([
      prisma.booking.updateMany({
        where: { id: { in: dueIds } },
        // Fenêtre de notification différée éventuelle (validation-notice) refermée :
        // l'auto-validation notifie elle-même, sans quoi le cron doublerait l'e-mail.
        data: {
          validated: true,
          autoValidatedAt: now,
          validationNoticeFrom: null,
          validationNoticeDueAt: null,
        },
      }),
      // Propagation aux réservations-enfants des récurrents validés.
      prisma.booking.updateMany({
        where: { parentBookingId: { in: dueRecurringIds } },
        data: { validated: true },
      }),
    ]);
    // Envois après commit, best-effort : réglages/template/appUrl chargés une fois (anti-N+1).
    await sendBookingConfirmationMailsBatch(mails);
  }

  return stats;
}
