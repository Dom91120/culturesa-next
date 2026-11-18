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
