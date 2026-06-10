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

export type SessionAttendee = {
  nom: string;
  prenom: string;
  structure: string;
  demandeur: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  pointage: "present" | "absent" | null;
};

export type DatedSession = {
  date: string; // YYYY-MM-DD
  dateLabel: string; // 02/06/2026
  dayKey: string; // lun..dim
  dayLabel: string; // Lundi
  startTime: string;
  endTime: string;
  attendees: SessionAttendee[];
};

const ISO_DAYKEY = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

/**
 * Sessions DATÉES (occurrences) d'un service sur une plage [from, to], groupées par
 * date + créneau, avec leurs participants. Inclut les ponctuels autonomes ET les miroirs
 * des récurrentes (toutes les occurrences qui portent une date). Sert aux éditions
 * « planning hebdomadaire » et « pointages ».
 */
export async function listDatedSessions(
  serviceId: string,
  fromYmd: string,
  toYmd: string,
): Promise<DatedSession[]> {
  const rows = await prisma.booking.findMany({
    where: {
      serviceId,
      slot: {
        slotDate: { gte: new Date(`${fromYmd}T00:00:00Z`), lte: new Date(`${toYmd}T23:59:59Z`) },
      },
    },
    select: {
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      pointage: true,
      slot: { select: { startTime: true, endTime: true, slotDate: true } },
      user: {
        select: {
          nom: true,
          prenom: true,
          structure: { select: { label: true } },
          demandeur: { select: { label: true } },
        },
      },
    },
  });

  const map = new Map<string, DatedSession>();
  for (const b of rows) {
    if (!b.slot.slotDate) continue;
    const date = b.slot.slotDate.toISOString().slice(0, 10);
    const key = `${date}|${b.slot.startTime}|${b.slot.endTime}`;
    let s = map.get(key);
    if (!s) {
      const dayKey = ISO_DAYKEY[b.slot.slotDate.getUTCDay()];
      s = {
        date,
        dateLabel: dateFmt.format(b.slot.slotDate),
        dayKey,
        dayLabel: DAY_NAMES[dayKey] ?? dayKey,
        startTime: b.slot.startTime,
        endTime: b.slot.endTime,
        attendees: [],
      };
      map.set(key, s);
    }
    s.attendees.push({
      nom: b.user.nom,
      prenom: b.user.prenom,
      structure: b.user.structure?.label ?? "",
      demandeur: b.user.demandeur?.label ?? "",
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      theme: b.themeLabel,
      pointage: b.pointage,
    });
  }

  const sessions = [...map.values()];
  for (const s of sessions) {
    s.attendees.sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return sessions;
}

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
