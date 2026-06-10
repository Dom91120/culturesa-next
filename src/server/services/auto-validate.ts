import { prisma } from "@/server/db";
import { sendBookingConfirmationMail } from "@/server/services/booking-mail";

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

const TZ = "Europe/Paris";
const DOW_KEY = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const;

// Heures ouvrées exprimées en heure murale FR : on isole la conversion instant ↔
// heure murale Paris pour ne PAS dépendre du fuseau du serveur (Node tourne en UTC).

/** Minutes dont Paris est en avance sur UTC à cet instant (60 hiver / 120 été). */
function parisOffsetMin(instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = dtf.formatToParts(instant);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

type Wall = { y: number; mo: number; da: number; min: number };

/** Instant → heure murale Paris (min = minutes depuis minuit). */
function toParisWall(instant: Date): Wall {
  const w = new Date(instant.getTime() + parisOffsetMin(instant) * 60000);
  return {
    y: w.getUTCFullYear(),
    mo: w.getUTCMonth() + 1,
    da: w.getUTCDate(),
    min: w.getUTCHours() * 60 + w.getUTCMinutes(),
  };
}

/** Heure murale Paris (jour + minutes) → instant UTC. */
function parisWallToInstant(y: number, mo: number, da: number, min: number): Date {
  const guess = Date.UTC(y, mo - 1, da, 0, min);
  return new Date(guess - parisOffsetMin(new Date(guess)) * 60000);
}

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
    if (!activeDays.includes(DOW_KEY[wallDow(y, mo, da)])) {
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
      activeDays: true,
      morningStart: true,
      morningEnd: true,
      afternoonStart: true,
      afternoonEnd: true,
    },
  });

  for (const svc of services) {
    stats.services += 1;
    const delay = svc.autoValidationDelay;
    const delayMinutes = Math.abs(delay);
    const isBusiness = delay < 0;
    const activeDays = svc.activeDays
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const cands = await prisma.booking.findMany({
      where: {
        serviceId: svc.id,
        validated: false,
        parentBookingId: null,
        autoValidateFrom: { not: null },
      },
      select: {
        id: true,
        bookingType: true,
        userId: true,
        periodId: true,
        themeLabel: true,
        enfants: true,
        accompagnants: true,
        autoValidateFrom: true,
        slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
      },
    });
    stats.candidates += cands.length;
    if (cands.length === 0) continue;

    // Fin de période pour le test « séance passée » des réservations récurrentes.
    const periodIds = [
      ...new Set(
        cands.filter((c) => c.bookingType === "recurring" && c.periodId > 0).map((c) => c.periodId),
      ),
    ];
    const periodEnd = new Map<number, Date | null>(
      (
        await prisma.period.findMany({
          where: { id: { in: periodIds } },
          select: { id: true, dateEnd: true },
        })
      ).map((p) => [p.id, p.dateEnd]),
    );

    for (const c of cands) {
      // Séance déjà passée → on n'auto-valide pas.
      const past =
        c.bookingType === "unique"
          ? c.slot.slotDate != null && toIso(c.slot.slotDate) < todayIso
          : (() => {
              const end = periodEnd.get(c.periodId);
              return end != null && toIso(end) < todayIso;
            })();
      if (past) {
        stats.skippedPast += 1;
        continue;
      }

      const from = c.autoValidateFrom;
      if (!from) continue;
      const deadline = isBusiness
        ? businessDeadline(
            from,
            delayMinutes,
            activeDays,
            svc.morningStart,
            svc.morningEnd,
            svc.afternoonStart,
            svc.afternoonEnd,
          )
        : new Date(from.getTime() + delayMinutes * 60000);

      if (deadline.getTime() > now.getTime()) {
        stats.notYet += 1;
        continue;
      }

      await prisma.$transaction([
        prisma.booking.update({
          where: { id: c.id },
          data: { validated: true, autoValidatedAt: now },
        }),
        // Validation au niveau de la série : propage aux réservations-enfants.
        ...(c.bookingType === "recurring"
          ? [
              prisma.booking.updateMany({
                where: { parentBookingId: c.id },
                data: { validated: true },
              }),
            ]
          : []),
      ]);
      stats.validated += 1;

      // Notification usager : réutilise l'e-mail « Réservation confirmée » (best-effort).
      await sendBookingConfirmationMail({
        userId: c.userId,
        serviceId: svc.id,
        serviceLabel: svc.label,
        validated: true,
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

  return stats;
}
