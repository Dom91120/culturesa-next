import { wrapEmailHtml } from "@/lib/email-theme";
import { prisma } from "@/server/db";
import { sendMailOrQueue } from "@/server/mailer";
import { isMailEnabled } from "@/server/services/mail-prefs";
import {
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";

// Notification e-mail envoyée à l'usager lors de la création d'une réservation.
// Best-effort : ne lève jamais (les échecs d'envoi partent en file via sendMailOrQueue).

const DAY_LABELS: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

/** Libellé « créneau » lisible : date+heure (ponctuel) ou jour+heure (récurrent). */
function slotLabel(slot: {
  startTime: string;
  endTime: string;
  slotDate: Date | null;
  slotDay: string | null;
}): string {
  const s = (slot.startTime || "").slice(0, 5);
  const e = (slot.endTime || "").slice(0, 5);
  const time = s && e ? `${s} – ${e}` : "Journée entière";
  if (slot.slotDate) {
    // slotDate stocké à minuit UTC → formatage en UTC pour éviter tout décalage de jour.
    const d = slot.slotDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${d} · ${time}`;
  }
  const day = slot.slotDay ? (DAY_LABELS[slot.slotDay] ?? slot.slotDay) : "";
  return [day, time].filter(Boolean).join(" · ");
}

/**
 * Libellé de la période d'une réservation. Récurrent → résolu par `periodId` ;
 * ponctuel (periodId absent/0) → période ACTIVE du service couvrant la date du
 * créneau. Renvoie "" si rien ne correspond.
 */
export async function resolvePeriodLabel(args: {
  serviceId: string;
  periodId?: number | null;
  slotDate?: Date | null;
}): Promise<string> {
  if (args.periodId && args.periodId > 0) {
    const p = await prisma.period.findUnique({
      where: { id: args.periodId },
      select: { label: true },
    });
    if (p?.label) return p.label;
  }
  if (args.slotDate) {
    const p = await prisma.period.findFirst({
      where: {
        serviceId: args.serviceId,
        dateStart: { lte: args.slotDate },
        dateEnd: { gte: args.slotDate },
      },
      select: { label: true },
      orderBy: { dateStart: "desc" },
    });
    if (p?.label) return p.label;
  }
  return "";
}

export type BookingConfirmationParams = {
  userId: string;
  serviceId: string;
  serviceLabel: string;
  // validated=true → réservation confirmée ; false → demande en attente de validation.
  validated: boolean;
  slot: { startTime: string; endTime: string; slotDate: Date | null; slotDay: string | null };
  periodId?: number | null;
  enfants: number;
  accompagnants: number;
  theme: string;
};

/**
 * Envoie à l'usager l'e-mail de confirmation d'une réservation (ou demande de
 * réservation selon `validated`) : détail du créneau + démarches suivantes.
 * Totalement best-effort : toute erreur est seulement journalisée.
 */
export async function sendBookingConfirmationMail(
  params: BookingConfirmationParams,
): Promise<void> {
  try {
    // Préférence « Échanges » : ce type d'e-mail est-il activé ?
    if (!(await isMailEnabled(params.validated ? "booking_confirmed" : "booking_pending"))) return;

    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, prenom: true },
    });
    const email = user?.email?.trim();
    if (!email?.includes("@")) return;

    const periodLabel = await resolvePeriodLabel({
      serviceId: params.serviceId,
      periodId: params.periodId,
      slotDate: params.slot.slotDate,
    });

    const prenom = user?.prenom?.trim() ?? "";
    const participants = [
      `${params.enfants} enfant${params.enfants > 1 ? "s" : ""}`,
      params.accompagnants > 0
        ? `${params.accompagnants} accompagnant${params.accompagnants > 1 ? "s" : ""}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");

    const vars: Record<string, string> = {
      salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,",
      prenom,
      service: params.serviceLabel,
      creneau: slotLabel(params.slot),
      periode: periodLabel,
      participants,
      theme: params.theme.trim(),
    };

    const kind = params.validated ? "booking_confirmed" : "booking_pending";
    const tpl = await getMailTemplate(kind);
    const inner = renderHtmlTemplate(tpl.html, vars);
    const subject = renderSubjectTemplate(tpl.subject, vars);
    await sendMailOrQueue({
      to: email,
      subject,
      html: wrapEmailHtml(inner, { preheader: subject }),
      text: htmlToText(inner),
    });
  } catch (e) {
    console.error("[sendBookingConfirmationMail] erreur:", e);
  }
}
