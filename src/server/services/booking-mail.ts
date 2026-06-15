import { DAY_NAMES } from "@/lib/agenda-core";
import { prisma } from "@/server/db";
import { isMailEnabled } from "@/server/services/mail-prefs";
import { sendTemplatedMail } from "@/server/services/mail-send";

// Notification e-mail envoyée à l'usager lors de la création d'une réservation.
// Best-effort : ne lève jamais (les échecs d'envoi partent en file via sendMailOrQueue).

// Libellés de jours : source unique = DAY_NAMES (lib/agenda-core, pur — audit D2).

/** Libellé « créneau » lisible : date+heure (ponctuel) ou jour+heure (récurrent). */
export function formatSlotLabel(slot: {
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
  const day = slot.slotDay ? (DAY_NAMES[slot.slotDay] ?? slot.slotDay) : "";
  return [day, time].filter(Boolean).join(" · ");
}

export type PeriodLabelInput = {
  serviceId: string;
  periodId?: number | null;
  slotDate?: Date | null;
};

/**
 * Version batch : résout les libellés de période pour une liste d'occurrences en
 * 2 requêtes au plus (au lieu d'une par occurrence — anti-N+1 des crons). Les
 * libellés sont renvoyés alignés sur l'index d'entrée. Mêmes règles que
 * resolvePeriodLabel : priorité au `periodId`, repli sur la période du service
 * couvrant la date du créneau.
 */
export async function resolvePeriodLabels(
  items: ReadonlyArray<PeriodLabelInput>,
): Promise<string[]> {
  // 1) Libellés par periodId — une seule requête pour tous les ids distincts.
  const periodIds = [
    ...new Set(items.map((i) => i.periodId).filter((id): id is number => !!id && id > 0)),
  ];
  const byId = new Map<number, string>();
  if (periodIds.length > 0) {
    const rows = await prisma.period.findMany({
      where: { id: { in: periodIds } },
      select: { id: true, label: true },
    });
    for (const r of rows) if (r.label) byId.set(r.id, r.label);
  }

  // 2) Repli par service + date pour les occurrences non résolues par periodId.
  //    On charge toutes les périodes des services concernés (peu nombreuses) et on
  //    résout en mémoire — équivalent au findFirst(orderBy dateStart desc) original.
  const needDate = items.filter(
    (i) => !(i.periodId && i.periodId > 0 && byId.has(i.periodId)) && i.slotDate,
  );
  const periodsByService = new Map<
    string,
    Array<{ dateStart: Date | null; dateEnd: Date | null; label: string }>
  >();
  if (needDate.length > 0) {
    const serviceIds = [...new Set(needDate.map((i) => i.serviceId))];
    const rows = await prisma.period.findMany({
      where: { serviceId: { in: serviceIds } },
      select: { serviceId: true, dateStart: true, dateEnd: true, label: true },
      orderBy: { dateStart: "desc" },
    });
    for (const r of rows) {
      if (!r.serviceId) continue;
      const list = periodsByService.get(r.serviceId) ?? [];
      list.push({ dateStart: r.dateStart, dateEnd: r.dateEnd, label: r.label });
      periodsByService.set(r.serviceId, list);
    }
  }

  return items.map((i) => {
    if (i.periodId && i.periodId > 0) {
      const l = byId.get(i.periodId);
      if (l) return l;
    }
    const d = i.slotDate;
    if (d) {
      // Périodes déjà triées dateStart desc → la première couvrant la date == findFirst.
      const hit = (periodsByService.get(i.serviceId) ?? []).find(
        (p) => p.dateStart && p.dateEnd && p.dateStart <= d && p.dateEnd >= d,
      );
      if (hit?.label) return hit.label;
    }
    return "";
  });
}

/**
 * Libellé de la période d'une réservation. Récurrent → résolu par `periodId` ;
 * ponctuel (periodId absent/0) → période ACTIVE du service couvrant la date du
 * créneau. Renvoie "" si rien ne correspond. Délègue à resolvePeriodLabels.
 */
export async function resolvePeriodLabel(args: PeriodLabelInput): Promise<string> {
  return (await resolvePeriodLabels([args]))[0] ?? "";
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
      creneau: formatSlotLabel(params.slot),
      periode: periodLabel,
      participants,
      theme: params.theme.trim(),
    };

    const kind = params.validated ? "booking_confirmed" : "booking_pending";
    await sendTemplatedMail({ to: email, kind, vars });
  } catch (e) {
    console.error("[sendBookingConfirmationMail] erreur:", e);
  }
}

export type BookingCancellationParams = {
  userId: string;
  serviceId: string;
  slotId: string;
  periodId?: number | null;
  // Motif affiché dans l'e-mail (ex. « Supprimée par l'utilisateur »).
  motif: string;
};

/**
 * Envoie à l'usager l'e-mail « Réservation annulée » (kind `booking_cancelled`) après la
 * suppression d'une de ses réservations. Le créneau, le service et la période sont résolus
 * APRÈS coup (le slot/le service existent toujours, seule la réservation est supprimée).
 * Totalement best-effort : toute erreur est seulement journalisée.
 */
export async function sendBookingCancellationMail(
  params: BookingCancellationParams,
): Promise<void> {
  try {
    if (!(await isMailEnabled("booking_cancelled"))) return;

    const [user, slot] = await Promise.all([
      prisma.user.findUnique({
        where: { id: params.userId },
        select: { email: true, prenom: true },
      }),
      prisma.slot.findUnique({
        where: { id: params.slotId },
        select: {
          startTime: true,
          endTime: true,
          slotDate: true,
          slotDay: true,
          service: { select: { label: true } },
        },
      }),
    ]);
    const email = user?.email?.trim();
    if (!email?.includes("@")) return;

    const periodLabel = await resolvePeriodLabel({
      serviceId: params.serviceId,
      periodId: params.periodId,
      slotDate: slot?.slotDate ?? null,
    });

    const prenom = user?.prenom?.trim() ?? "";
    const vars: Record<string, string> = {
      salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,",
      prenom,
      service: slot?.service.label ?? "",
      creneau: slot ? formatSlotLabel(slot) : "",
      periode: periodLabel,
      motif: params.motif,
    };

    await sendTemplatedMail({ to: email, kind: "booking_cancelled", vars });
  } catch (e) {
    console.error("[sendBookingCancellationMail] erreur:", e);
  }
}
