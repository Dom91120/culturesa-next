import { prisma } from "@/server/db";

// ════════════════════════════════════════════════════════════════════════════
//  Périmètre « accueils de loisirs » — rôle `direction_loisirs` (Dom 2026-11-18).
//
//  La Direction des accueils de loisirs n'a AUCUN rattachement nominatif à un service.
//  Tout se déduit du marqueur `Demandeur.accueilLoisirs` (Administration ›
//  Configuration › Demandeurs) :
//    - un service lui est ouvert si sa matrice demandeurs ACCEPTE une catégorie marquée ;
//    - elle n'y lit que les réservations des usagers de ces catégories.
//
//  Module sans dépendance à la session (ni `next/headers`) : utilisable depuis les
//  gardes comme depuis les services de lecture, et testable sans environnement Next.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Catégories « accueil de loisirs » ACCEPTÉES par ce service (lignes de la matrice
 * demandeurs dont la catégorie porte `accueilLoisirs`). Liste vide = le service
 * n'accueille aucun accueil de loisirs → invisible pour la Direction.
 */
export async function loisirsDemandeurIds(serviceId: string): Promise<number[]> {
  const rows = await prisma.serviceDemandeurSettings.findMany({
    where: { serviceId, demandeur: { accueilLoisirs: true } },
    select: { demandeurId: true },
  });
  return rows.map((r) => r.demandeurId);
}

/**
 * Filtre Prisma « usager d'une de ces catégories », sur le demandeur EFFECTIF (le sien,
 * sinon celui de sa structure — même repli que `resolveEffectiveDemandeurId`). À poser
 * sur la relation `user` d'une réservation. Un compte anonymisé (plus de rattachement)
 * n'y correspond jamais.
 */
export function loisirsUserWhere(demandeurIds: number[]) {
  return {
    OR: [
      { demandeurId: { in: demandeurIds } },
      { demandeurId: null, structure: { demandeurId: { in: demandeurIds } } },
    ],
  };
}

/**
 * Occupation des créneaux datés par les AUTRES catégories — tout ce que la Direction
 * ne voit pas — pour l'affichage « N places restantes » de son agenda. Un total par
 * créneau (nombre de réservations, enfants, accompagnants) : ni identité, ni détail par
 * réservation ne quitte le serveur.
 *
 * Mêmes bornes que les réservations de l'agenda (types récurrent / ponctuel, périodes
 * affichées). Seuls les créneaux DATÉS comptent : en semaine réelle, une récurrente
 * occupe ses occurrences (réservations-enfants sur les slots miroirs), pas son modèle.
 * Un compte anonymisé n'a plus de catégorie : il tombe ici, donc reste compté.
 */
export async function loisirsHiddenOccupancyRows(
  serviceId: string,
  periodIds: number[],
  demandeurIds: number[],
): Promise<{ slotId: string; count: number; enfants: number; accompagnants: number }[]> {
  const rows = await prisma.booking.groupBy({
    by: ["slotId"],
    where: {
      serviceId,
      bookingType: { in: ["recurring", "unique"] },
      slot: { periodId: { in: periodIds }, slotType: "unique" },
      NOT: { user: loisirsUserWhere(demandeurIds) },
    },
    _count: { _all: true },
    _sum: { enfants: true, accompagnants: true },
  });
  return rows.map((r) => ({
    slotId: r.slotId,
    count: r._count._all,
    enfants: r._sum.enfants ?? 0,
    accompagnants: r._sum.accompagnants ?? 0,
  }));
}
