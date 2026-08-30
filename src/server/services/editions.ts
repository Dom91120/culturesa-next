import { DAY_NAMES, ISO_DAY_KEYS } from "@/lib/agenda-core";
import { DATE_FMT_FR as dateFmt } from "@/lib/format";
import { prisma } from "@/server/db";

// Libellés de jours : source unique = DAY_NAMES (lib/agenda-core, pur — audit D2).

/** Libellés des états de pointage (partagé par les écrans Liste et Pointages). */
export const POINTAGE_LABEL: Record<string, string> = { present: "Présent", absent: "Absent" };

type EditionRow = {
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
  email: string;
  tel: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  pointage: "present" | "absent" | null;
  // Motif d'absence saisi dans la fiche (vide sinon) — feuille de pointage.
  pointageMotif: string;
  statut: string;
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
  // Restreint aux réservations des périodes de l'exercice sélectionné (scope exercice).
  periodIds?: number[],
): Promise<DatedSession[]> {
  const rows = await prisma.booking.findMany({
    where: {
      serviceId,
      // Scope exercice via le CRÉNEAU : booking.periodId est null pour les ponctuels,
      // alors que slot.periodId est renseigné pour récurrents ET ponctuels.
      slot: {
        ...(periodIds ? { periodId: { in: periodIds } } : {}),
        slotDate: { gte: new Date(`${fromYmd}T00:00:00Z`), lte: new Date(`${toYmd}T23:59:59Z`) },
      },
    },
    select: {
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      pointage: true,
      pointageMotif: true,
      validated: true,
      slot: { select: { startTime: true, endTime: true, slotDate: true } },
      user: {
        select: {
          nom: true,
          prenom: true,
          email: true,
          tel: true,
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
      const dayKey = ISO_DAY_KEYS[b.slot.slotDate.getUTCDay()];
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
      email: b.user.email ?? "",
      tel: b.user.tel ?? "",
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      theme: b.themeLabel,
      pointage: b.pointage,
      pointageMotif: b.pointageMotif,
      statut: b.validated ? "Validée" : "En attente",
    });
  }

  const sessions = [...map.values()];
  for (const s of sessions) {
    s.attendees.sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return sessions;
}

export type Inscrit = {
  nom: string;
  prenom: string;
  structure: string; // structure de l'usager (repli sur la catégorie)
  demandeur: string; // catégorie
  niveau: string;
  email: string;
  tel: string;
};

/**
 * Usagers DISTINCTS ayant au moins une réservation du service — édition « Liste des
 * inscrits ». Scope exercice via le CRÉNEAU (slot.periodId, comme les autres éditions :
 * booking.periodId est null pour ponctuels et enfants). Fiche VIVANTE (document
 * opérationnel, pas de l'historique — cf. décision snapshot stats) ; tri nom/prénom.
 */
export async function listInscrits(serviceId: string, periodIds?: number[]): Promise<Inscrit[]> {
  const rows = await prisma.booking.findMany({
    where: {
      serviceId,
      ...(periodIds ? { slot: { periodId: { in: periodIds } } } : {}),
    },
    distinct: ["userId"],
    select: {
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
    },
  });
  return rows
    .map((r) => ({
      nom: r.user.nom,
      prenom: r.user.prenom,
      structure: r.user.structure?.label ?? "",
      demandeur: r.user.demandeur?.label ?? "",
      niveau: r.user.niveau ?? "",
      email: r.user.email ?? "",
      tel: r.user.tel ?? "",
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom) || a.prenom.localeCompare(b.prenom));
}

/** « Lundi 18/06/2026 » pour un ponctuel daté ; jour de semaine pour un récurrent. */
function jourDateOf(bookingType: string, slotDate: Date | null, slotDay: string | null): string {
  if (bookingType === "unique") {
    if (!slotDate) return "—";
    const day = DAY_NAMES[ISO_DAY_KEYS[slotDate.getUTCDay()]] ?? "";
    return `${day} ${dateFmt.format(slotDate)}`.trim();
  }
  return DAY_NAMES[slotDay ?? ""] ?? slotDay ?? "—";
}

/**
 * Lignes de réservation d'un service, prêtes pour l'affichage et l'export CSV.
 * `userId` fourni → restreint aux réservations de CET usager (export « mes réservations »),
 * en excluant les miroirs : une ligne par RÉSERVATION (abonnement), pas par occurrence.
 * Sans `userId` (export CSV admin) → une ligne par SÉANCE DATÉE (réservations-enfants
 * des récurrentes + ponctuelles autonomes), granularité de l'écran Liste et des
 * Statistiques. Les PARENTES récurrentes sont exclues : avant l'audit 2026-07-24, le
 * CSV mélangeait la ligne d'abonnement ET ses ~36 séances (double comptage garanti
 * dans tout tableur). Période et date de dépôt d'une séance : reprises du PARENT
 * (l'enfant porte periodId NULL et un createdAt de matérialisation).
 */
export async function listEditionRows(
  serviceId: string,
  userId?: string,
  // Restreint aux réservations des périodes de l'exercice sélectionné (scope exercice).
  scopePeriodIds?: number[],
): Promise<EditionRow[]> {
  const bookings = await prisma.booking.findMany({
    where: {
      serviceId,
      // Admin : séances datées seules — un parent récurrent est le seul bookingType
      // "recurring" (ses enfants matérialisés sont des "unique" sur slots miroirs).
      ...(userId ? { userId, parentBookingId: null } : { bookingType: "unique" }),
      // Scope exercice via le CRÉNEAU (slot.periodId) : booking.periodId est null pour
      // les ponctuels — filtrer dessus les excluait (récurrents seuls visibles).
      ...(scopePeriodIds ? { slot: { periodId: { in: scopePeriodIds } } } : {}),
    },
    // Usager (une ligne par réservation) : tri legacy période puis dépôt. Admin (une
    // ligne par séance) : tri chronologique des séances, comme l'écran Liste.
    orderBy: userId
      ? [{ periodId: "asc" }, { createdAt: "asc" }]
      : [{ slot: { slotDate: "asc" } }, { slot: { startTime: "asc" } }, { createdAt: "asc" }],
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
      parentBookingId: true,
      // Parent d'une séance de récurrente : porte la période et la vraie date de dépôt.
      parent: { select: { periodId: true, createdAt: true } },
    },
  });

  const periodIds = [
    ...new Set(
      bookings
        .map((b) => b.periodId ?? b.parent?.periodId)
        .filter((p): p is number => p != null && p > 0),
    ),
  ];
  const periods = await prisma.period.findMany({
    where: { id: { in: periodIds } },
    select: { id: true, label: true },
  });
  const periodLabel = new Map(periods.map((p) => [p.id, p.label]));

  return bookings.map((b) => {
    const s = b.slot.startTime ? b.slot.startTime.slice(0, 5) : "";
    const e = b.slot.endTime ? b.slot.endTime.slice(0, 5) : "";
    const demandeurLabel = b.user.demandeur?.label ?? "";
    // Séance issue d'une récurrente (enfant matérialisé, techniquement "unique") :
    // le TYPE affiché reste « Récurrente », la période et la date de dépôt sont
    // celles du parent.
    const isRecurringChild = b.parentBookingId != null;
    return {
      id: b.id,
      type: b.bookingType === "recurring" || isRecurringChild ? "Récurrente" : "Ponctuelle",
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
      periode: periodLabel.get(b.periodId ?? b.parent?.periodId ?? 0) ?? "—",
      creneau: s && e ? `${s} – ${e}` : "Journée entière",
      debut: b.slot.startTime,
      fin: b.slot.endTime,
      jour: jourDateOf(b.bookingType, b.slot.slotDate, b.slot.slotDay),
      jourDate: jourDateOf(b.bookingType, b.slot.slotDate, b.slot.slotDay),
      theme: b.themeLabel,
      statut: b.validated ? "Validée" : "En attente",
      pointage: b.pointage === "present" ? "Présent" : b.pointage === "absent" ? "Absent" : "",
      createdAt: (b.parent?.createdAt ?? b.createdAt).toISOString().slice(0, 16).replace("T", " "),
    };
  });
}
