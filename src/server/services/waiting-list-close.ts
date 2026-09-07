import type { Prisma } from "@/generated/prisma/client";
import { formatSlotLabel, type WaitlistDeletionMode } from "@/lib/slot-label";
import { getSession } from "@/server/guards";

// ─── Clôture d'inscriptions en liste d'attente ──────────────────────────────────
// Module SANS dépendance vers bookings.ts / user-booking.ts : il est appelé depuis les
// cœurs de création de réservation (toute réservation obtenue sur le service retire
// l'usager de la liste — Dom 2026-09-07) sans créer de cycle d'imports avec
// services/waiting-list.ts, qui le réexporte.

/**
 * Issue posée par l'appelant à la clôture. BOOKED est passé par les cœurs de réservation
 * (réservation obtenue : par l'usager, par un gestionnaire, ou par la tâche planifiée qui
 * requalifie ensuite en AUTO_BOOKED) et DÉDUIT au retrait si une réservation a suivi.
 */
export type WaitingListClosure =
  | "AUTO_BOOKED"
  | "BOOKED"
  | "LEFT"
  | "REMOVED"
  | "EXPIRED"
  | "ANONYMIZED";

/**
 * CLÔTURE d'inscriptions en liste d'attente : chaque entrée vivante trouvée est copiée
 * dans l'historique (liste_attente_historique, catégorie / structure figées) puis
 * supprimée. Pour un retrait (usager ou gestionnaire), si l'usager a fait une réservation
 * sur le service APRÈS son inscription, l'issue devient « a obtenu une réservation »
 * (BOOKED) et la réservation est liée. Renvoie le nombre d'entrées clôturées.
 */
export async function closeWaitingEntries(
  db: Prisma.TransactionClient,
  where: Prisma.WaitingListEntryWhereInput,
  outcome: WaitingListClosure,
  bookingId: number | null = null,
): Promise<number> {
  const entries = await db.waitingListEntry.findMany({
    where,
    select: {
      id: true,
      serviceId: true,
      userId: true,
      disponibilites: true,
      periodIds: true,
      autoInscription: true,
      createdAt: true,
      user: {
        select: { demandeur: { select: { label: true } }, structure: { select: { label: true } } },
      },
    },
  });
  for (const e of entries) {
    let issue: Prisma.WaitingListLogCreateInput["issue"] = outcome;
    let linked = bookingId;
    if (outcome === "LEFT" || outcome === "REMOVED") {
      const b = await db.booking.findFirst({
        where: {
          userId: e.userId,
          serviceId: e.serviceId,
          parentBookingId: null,
          createdAt: { gt: e.createdAt },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (b) {
        issue = "BOOKED";
        linked = b.id;
      }
    }
    // Réservation obtenue : créneau et période FIGÉS (lisibles après suppression).
    const snap = linked ? await bookingSnapshot(db, linked) : null;
    await db.waitingListLog.create({
      data: {
        serviceId: e.serviceId,
        userId: e.userId,
        demandeurLabel: e.user.demandeur?.label ?? "",
        structureLabel: e.user.structure?.label ?? "",
        disponibilites: e.disponibilites,
        periodIds: e.periodIds,
        autoInscription: e.autoInscription,
        inscritAt: e.createdAt,
        issue,
        bookingId: linked,
        creneauLabel: snap?.creneau ?? "",
        periodeLabel: snap?.periode ?? "",
      },
    });
    await db.waitingListEntry.delete({ where: { id: e.id } });
  }
  return entries.length;
}

async function bookingSnapshot(
  db: Prisma.TransactionClient,
  bookingId: number,
): Promise<{ creneau: string; periode: string } | null> {
  const b = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      period: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  return b ? { creneau: formatSlotLabel(b.slot), periode: b.period?.label ?? "" } : null;
}

/** « NOM Prénom » du gestionnaire / administrateur connecté ; vide hors requête ou usager. */
async function currentManagerLabel(db: Prisma.TransactionClient): Promise<string> {
  try {
    const session = await getSession();
    if (!session) return "";
    const u = await db.user.findUnique({
      where: { id: session.user.id },
      select: { nom: true, prenom: true, role: true },
    });
    if (!u || u.role === "utilisateur") return "";
    return `${u.nom} ${u.prenom}`.trim();
  } catch {
    return "";
  }
}

/**
 * TRACE de suppression (Dom 2026-09-07) : à appeler AVANT de supprimer des réservations
 * (la FK met ensuite bookingId à NULL). Les lignes d'historique liées reçoivent la date,
 * le mode et, pour un gestionnaire, son nom. Idempotent (première suppression conservée).
 */
export async function markWaitlistBookingsDeleted(
  db: Prisma.TransactionClient,
  bookings: Prisma.BookingWhereInput,
  mode: WaitlistDeletionMode,
): Promise<number> {
  const linked = await db.waitingListLog.findMany({
    where: { booking: bookings, reservationSupprimeeAt: null },
    select: { id: true },
  });
  if (linked.length === 0) return 0;
  const par = mode === "usager" ? "" : await currentManagerLabel(db);
  const r = await db.waitingListLog.updateMany({
    where: { id: { in: linked.map((l) => l.id) } },
    data: {
      reservationSupprimeeAt: new Date(),
      reservationSupprimeePar: par,
      reservationSupprimeeMode: mode,
    },
  });
  return r.count;
}
