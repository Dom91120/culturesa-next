import { prisma } from "@/server/db";
import { sendBookingConfirmationMailsBatch } from "@/server/services/booking-mail";

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

  // Réservations dues, accumulées sur TOUS les services : validées en UNE transaction
  // (2 updateMany) au lieu d'une transaction par réservation (audit perf — cron
  // séquentiel). Les e-mails (un par usager, incompressible) partent APRÈS le commit,
  // best-effort, comme avant.
  const dueIds: number[] = [];
  const dueRecurringIds: number[] = [];
  const mails: Parameters<typeof sendBookingConfirmationMailsBatch>[0][number][] = [];

  const svcIds = services.map((s) => s.id);

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
        .filter((c) => c.bookingType === "recurring" && c.periodId > 0)
        .map((c) => c.periodId),
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
    const activeDays = svc.activeDays
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

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
        data: { validated: true, autoValidatedAt: now },
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
