import { DAY_NAMES } from "@/lib/agenda-core";
import { prisma } from "@/server/db";

// Libellés de jours : source unique = DAY_NAMES (lib/agenda-core, pur — audit D2).

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export type EditionRow = {
  id: number;
  type: string; // Récurrente / Ponctuelle
  structure: string; // structure de l'usager (repli sur le demandeur)
  niveau: string;
  demandeur: string; // libellé du demandeur (colonne de la PAGE)
  email: string;
  tel: string;
  nom: string;
  prenom: string;
  enfants: number;
  accompagnants: number;
  periode: string;
  creneau: string; // « HH:MM – HH:MM » ou « Journée entière »
  debut: string;
  fin: string;
  jour: string; // jour (récurrent) ou date (ponctuel) — colonne de la PAGE
  jourDate: string; // « Lundi 18/06/2026 » (ponctuel) ou jour (récurrent) — colonne CSV legacy
  theme: string;
  statut: string;
  pointage: string;
  createdAt: string; // date de réservation (YYYY-MM-DD HH:MM)
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

/** « Lundi 18/06/2026 » pour un ponctuel daté ; jour de semaine pour un récurrent. */
function jourDateOf(bookingType: string, slotDate: Date | null, slotDay: string | null): string {
  if (bookingType === "unique") {
    if (!slotDate) return "—";
    const day = DAY_NAMES[ISO_DAYKEY[slotDate.getUTCDay()]] ?? "";
    return `${day} ${dateFmt.format(slotDate)}`.trim();
  }
  return DAY_NAMES[slotDay ?? ""] ?? slotDay ?? "—";
}

/**
 * Lignes de réservation d'un service, prêtes pour l'affichage et l'export CSV.
 * `userId` fourni → restreint aux réservations de CET usager (export « mes réservations »),
 * en excluant les miroirs (une ligne par réservation, pas par occurrence).
 */
export async function listEditionRows(serviceId: string, userId?: string): Promise<EditionRow[]> {
  const bookings = await prisma.booking.findMany({
    where: { serviceId, ...(userId ? { userId, parentBookingId: null } : {}) },
    orderBy: [{ periodId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      bookingType: true,
      themeLabel: true,
      enfants: true,
      accompagnants: true,
      validated: true,
      pointage: true,
      createdAt: true,
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
      user: {
        select: {
          nom: true,
          prenom: true,
          email: true,
          tel: true,
          niveau: true,
          structure: { select: { label: true } },
          demandeur: { select: { label: true } },
        },
      },
      periodId: true,
    },
  });

  const periodIds = [...new Set(bookings.map((b) => b.periodId).filter((p) => p > 0))];
  const periods = await prisma.period.findMany({
    where: { id: { in: periodIds } },
    select: { id: true, label: true },
  });
  const periodLabel = new Map(periods.map((p) => [p.id, p.label]));

  return bookings.map((b) => {
    const s = b.slot.startTime ? b.slot.startTime.slice(0, 5) : "";
    const e = b.slot.endTime ? b.slot.endTime.slice(0, 5) : "";
    const demandeurLabel = b.user.demandeur?.label ?? "";
    return {
      id: b.id,
      type: b.bookingType === "recurring" ? "Récurrente" : "Ponctuelle",
      // Structure de l'usager, repli sur le demandeur (cohérent avec le legacy).
      structure: b.user.structure?.label || demandeurLabel,
      niveau: b.user.niveau ?? "",
      demandeur: demandeurLabel,
      email: b.user.email ?? "",
      tel: b.user.tel ?? "",
      nom: b.user.nom,
      prenom: b.user.prenom,
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      periode: periodLabel.get(b.periodId) ?? "—",
      creneau: s && e ? `${s} – ${e}` : "Journée entière",
      debut: b.slot.startTime,
      fin: b.slot.endTime,
      jour: jourDateOf(b.bookingType, b.slot.slotDate, b.slot.slotDay),
      jourDate: jourDateOf(b.bookingType, b.slot.slotDate, b.slot.slotDay),
      theme: b.themeLabel,
      statut: b.validated ? "Réservation validée" : "Demande en attente de validation",
      pointage: b.pointage === "present" ? "Présent" : b.pointage === "absent" ? "Absent" : "",
      createdAt: b.createdAt.toISOString().slice(0, 16).replace("T", " "),
    };
  });
}
