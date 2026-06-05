import { prisma } from "@/server/db";

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export type EditionRow = {
  id: number;
  periode: string;
  jour: string;
  debut: string;
  fin: string;
  demandeur: string;
  nom: string;
  prenom: string;
  theme: string;
  enfants: number;
  statut: string;
  pointage: string;
};

/** Lignes de réservation d'un service, prêtes pour l'affichage et l'export CSV. */
export async function listEditionRows(serviceId: string): Promise<EditionRow[]> {
  const bookings = await prisma.booking.findMany({
    where: { serviceId },
    orderBy: [{ periodId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      bookingType: true,
      themeLabel: true,
      enfants: true,
      validated: true,
      pointage: true,
      // Le jour est porté par le créneau (slotDay) ; date pour un ponctuel.
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
      user: { select: { nom: true, prenom: true, demandeur: { select: { label: true } } } },
      // Pas de relation period sur Booking : on récupère le libellé séparément.
      periodId: true,
    },
  });

  const periodIds = [...new Set(bookings.map((b) => b.periodId).filter((p) => p > 0))];
  const periods = await prisma.period.findMany({
    where: { id: { in: periodIds } },
    select: { id: true, label: true },
  });
  const periodLabel = new Map(periods.map((p) => [p.id, p.label]));

  return bookings.map((b) => ({
    id: b.id,
    periode: periodLabel.get(b.periodId) ?? "—",
    jour:
      b.bookingType === "unique"
        ? b.slot.slotDate
          ? dateFmt.format(b.slot.slotDate)
          : "—"
        : (DAY_NAMES[b.slot.slotDay ?? ""] ?? b.slot.slotDay ?? "—"),
    debut: b.slot.startTime,
    fin: b.slot.endTime,
    demandeur: b.user.demandeur?.label ?? "",
    nom: b.user.nom,
    prenom: b.user.prenom,
    theme: b.themeLabel,
    enfants: b.enfants,
    statut: b.validated ? "Validée" : "En attente",
    pointage: b.pointage === "present" ? "Présent" : b.pointage === "absent" ? "Absent" : "",
  }));
}
