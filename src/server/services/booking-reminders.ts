import { wrapEmailHtml } from "@/lib/email-theme";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { formatSlotLabel, resolvePeriodLabel } from "@/server/services/booking-mail";
import { isMailEnabled } from "@/server/services/mail-prefs";
import {
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";

// Rappels de réservation envoyés J-7 (« week ») puis J-1 (« day ») avant chaque
// occurrence d'une réservation CONFIRMÉE. Idempotent : chaque envoi est journalisé
// dans `booking_reminders` (contrainte unique bookingId+slotDate+kind), si bien
// qu'une seconde exécution le même jour n'enverra rien.
//
// Les occurrences datées proviennent des slots :
//   - ponctuelle / sur miroir → `slot.slotDate` = la date ;
//   - récurrente → slots MIROIRS (`parentSlotId` = slot parent) déjà filtrés des
//     jours fériés et de la parité A/B à la génération. On rattache donc la
//     réservation (sur le slot parent) au miroir du jour, en vérifiant sa parité.

type Kind = "week" | "day";
const OFFSETS: ReadonlyArray<readonly [Kind, number]> = [
  ["week", 7],
  ["day", 1],
];
const ECHEANCE: Record<Kind, string> = { week: "dans une semaine", day: "demain" };

// Date (UTC) → "YYYY-MM-DD" ; "YYYY-MM-DD" → Date à minuit UTC (cf. slots.ts).
const toISO = (d: Date): string => d.toISOString().slice(0, 10);
const fromISO = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/**
 * Parcourt les occurrences à J-7 et J-1 et envoie le rappel aux réservations
 * confirmées qui n'en ont pas encore reçu. Best-effort : toute erreur d'envoi part
 * en file `failed_mails`. Renvoie le nombre de rappels traités par échéance.
 */
export async function runBookingReminders(now: Date = new Date()): Promise<{
  week: number;
  day: number;
}> {
  const result = { week: 0, day: 0 };

  // Préférence « Échanges » : ce type d'e-mail est-il activé ?
  if (!(await isMailEnabled("booking_reminder"))) return result;

  const tpl = await getMailTemplate("booking_reminder");
  const todayMidnight = fromISO(toISO(now));

  for (const [kind, offset] of OFFSETS) {
    const targetIso = toISO(new Date(todayMidnight.getTime() + offset * 86400000));
    const targetDate = fromISO(targetIso);

    // Tous les slots datés ce jour-là (créneaux ponctuels autonomes ET miroirs).
    const dated = await prisma.slot.findMany({
      where: { slotDate: targetDate, state: "actif" },
      select: { id: true, startTime: true, endTime: true },
    });
    if (dated.length === 0) continue;

    const directIds = dated.map((s) => s.id);

    // Réservations confirmées posées sur ces dates : réservations-enfants des
    // récurrentes OU ponctuelles autonomes (toutes deux sur un slot DATÉ). Plus de
    // dérivation par slot parent : chaque occurrence récurrente est désormais
    // matérialisée en réservation-enfant datée.
    const bookings = await prisma.booking.findMany({
      where: { validated: true, slotId: { in: directIds } },
      select: {
        id: true,
        slotId: true,
        serviceId: true,
        periodId: true,
        user: { select: { email: true, prenom: true } },
        service: { select: { label: true } },
      },
    });
    if (bookings.length === 0) continue;

    // Rappels déjà envoyés pour cette date + échéance → on les saute (idempotence).
    const already = new Set(
      (
        await prisma.bookingReminder.findMany({
          where: {
            kind,
            slotDate: targetDate,
            bookingId: { in: bookings.map((b) => b.id) },
          },
          select: { bookingId: true },
        })
      ).map((r) => r.bookingId),
    );

    for (const b of bookings) {
      if (already.has(b.id)) continue;

      // Slot d'occurrence à cette date = le slot daté direct de la réservation.
      const occ = dated.find((s) => s.id === b.slotId);
      if (!occ) continue;

      const email = b.user?.email?.trim();
      if (!email?.includes("@")) continue;

      const prenom = b.user?.prenom?.trim() ?? "";
      const periode = await resolvePeriodLabel({
        serviceId: b.serviceId,
        periodId: b.periodId,
        slotDate: targetDate,
      });
      const vars: Record<string, string> = {
        salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,",
        prenom,
        service: b.service?.label ?? "",
        creneau: formatSlotLabel({
          startTime: occ.startTime,
          endTime: occ.endTime,
          slotDate: targetDate,
          slotDay: null,
        }),
        periode,
        echeance: ECHEANCE[kind],
      };

      const inner = renderHtmlTemplate(tpl.html, vars);
      const subject = renderSubjectTemplate(tpl.subject, vars);
      try {
        await sendMailOrQueue({
          to: email,
          subject,
          html: wrapEmailHtml(inner, { preheader: subject }),
          text: htmlToText(inner),
        });
        // Journalise l'envoi (best-effort déjà géré par la file). La contrainte
        // unique protège des doublons en cas de concurrence.
        await prisma.bookingReminder.create({
          data: { bookingId: b.id, slotDate: targetDate, kind },
        });
        result[kind] += 1;
      } catch (e) {
        console.error("[runBookingReminders] erreur pour la réservation", b.id, e);
      }
    }
  }

  return result;
}
