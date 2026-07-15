import { getAppUrl } from "@/server/config";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { formatSlotLabel, resolvePeriodLabels } from "@/server/services/booking-mail";
import {
  getTriggerRecipient,
  isTriggerEnabled,
  type ResolvedRecipient,
  resolveTriggerKind,
  resolveTriggerRecipients,
} from "@/server/services/mail-prefs";
import { buildTemplatedMail } from "@/server/services/mail-send";
import { getMailTemplate } from "@/server/services/mail-templates";

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

  // Gabarit + préférence d'envoi sont PAR SERVICE → chargés plus bas, une fois par
  // service distinct de chaque lot (les réservations couvrent plusieurs services).
  const appUrl = await getAppUrl();
  const todayMidnight = fromISO(toISO(now));

  for (const [kind, offset] of OFFSETS) {
    const targetIso = toISO(new Date(todayMidnight.getTime() + offset * 86400000));
    const targetDate = fromISO(targetIso);

    // Tous les slots datés ce jour-là (créneaux ponctuels autonomes ET miroirs).
    const dated = await prisma.slot.findMany({
      where: { slotDate: targetDate },
      select: { id: true, startTime: true, endTime: true },
    });
    if (dated.length === 0) continue;

    const directIds = dated.map((s) => s.id);
    // Index slotId → slot pour éviter un dated.find() par réservation (O(n·m)) dans la boucle.
    const datedById = new Map(dated.map((s) => [s.id, s]));

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
        user: { select: { email: true, prenom: true, nom: true } },
        service: { select: { label: true } },
      },
    });
    if (bookings.length === 0) continue;

    // Libellés de période résolus en batch (anti-N+1) : toutes les occurrences de
    // cette échéance partagent la même date cible.
    const periodLabels = await resolvePeriodLabels(
      bookings.map((b) => ({ serviceId: b.serviceId, periodId: b.periodId, slotDate: targetDate })),
    );
    const periodByBooking = new Map(bookings.map((b, idx) => [b.id, periodLabels[idx] ?? ""]));

    // Réglages de l'action « rappel » désormais GLOBAUX (envoi / type / destinataire) :
    // lus UNE fois. Seul le CONTENU du gabarit reste surchargeable par service.
    const [enabled, kindForReminder, rec] = await Promise.all([
      isTriggerEnabled("reminder"),
      resolveTriggerKind("reminder"),
      getTriggerRecipient("reminder"),
    ]);
    const serviceIds = [...new Set(bookings.map((b) => b.serviceId))];
    const tplByService = new Map<string, { subject: string; html: string }>();
    // Pour les portées gestionnaires/admins/fixe, la liste de destinataires se résout PAR
    // SERVICE (gestionnaires du service concerné) et est la même pour toutes les réservations
    // du service → résolue UNE fois par service ici (anti-N+1).
    const svcRecipientsByService = new Map<string, ResolvedRecipient[]>();
    await Promise.all(
      serviceIds.map(async (sid) => {
        // Contenu du gabarit PAR SERVICE (cascade (svc,kind) → (global,kind) → défaut code).
        tplByService.set(sid, await getMailTemplate(kindForReminder, sid));
        if (rec.kind !== "usager") {
          svcRecipientsByService.set(sid, await resolveTriggerRecipients("reminder", sid, {}));
        }
      }),
    );

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

      // Rappels désactivés (réglage global) ? on saute. Sinon, gabarit propre au service.
      if (!enabled) continue;
      const tpl = tplByService.get(b.serviceId);
      if (!tpl) continue;

      // Slot d'occurrence à cette date = le slot daté direct de la réservation.
      const occ = datedById.get(b.slotId);
      if (!occ) continue;

      // Destinataire(s) selon le réglage GLOBAL de l'action « rappel » (défaut = usager concerné).
      const recipKind = rec.kind;
      let recipients: ResolvedRecipient[];
      if (recipKind === "usager") {
        const email = b.user?.email?.trim();
        if (!email?.includes("@")) continue;
        recipients = [{ email, prenom: b.user?.prenom?.trim() ?? "", personal: true }];
      } else {
        recipients = svcRecipientsByService.get(b.serviceId) ?? [];
        if (recipients.length === 0) continue;
      }

      const usager = `${b.user?.prenom ?? ""} ${b.user?.nom ?? ""}`.trim();
      const periode = periodByBooking.get(b.id) ?? "";
      const creneau = formatSlotLabel({
        startTime: occ.startTime,
        endTime: occ.endTime,
        slotDate: targetDate,
        slotDay: null,
      });
      const baseVars: Record<string, string> = {
        usager,
        service: b.service?.label ?? "",
        creneau,
        periode,
        echeance: ECHEANCE[kind],
      };

      try {
        for (const r of recipients) {
          const prenom = r.personal ? r.prenom : "";
          const vars = {
            ...baseVars,
            salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,",
            prenom,
          };
          await sendMailOrQueue({ to: r.email, ...buildTemplatedMail(tpl, vars, appUrl) });
        }
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
