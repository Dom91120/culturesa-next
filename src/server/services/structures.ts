import type { StructureInput } from "@/schemas/referentiels";
import { prisma } from "@/server/db";
import { currentExerciceIdsAllServices } from "@/server/services/exercice";

export function listStructures() {
  return prisma.structure.findMany({
    orderBy: [{ demandeurId: "asc" }, { label: "asc" }],
    include: { demandeur: { select: { label: true } }, _count: { select: { users: true } } },
  });
}

export function createStructure(data: StructureInput) {
  return prisma.structure.create({ data });
}

export function updateStructure(id: number, data: StructureInput) {
  return prisma.structure.update({ where: { id }, data });
}

export function deleteStructure(id: number) {
  return prisma.structure.delete({ where: { id } });
}

/**
 * Structure SAISIE (catégorie `structureLibre`, ex. « Autres ») → identifiant.
 *
 * Réutilise la structure existante si le libellé y correspond, la crée sinon. Le
 * rapprochement ignore la casse : « École du Parc » et « école du parc » désignent
 * la même structure, et deux lignes jumelles fausseraient les statistiques par
 * structure autant que les feuilles de pointage.
 *
 * Point d'entrée UNIQUE des deux chemins de saisie — inscription publique (hook
 * Better Auth) et modale d'administration —, pour qu'un même libellé donne la même
 * ligne d'où qu'il vienne. Le libellé est supposé DÉJÀ normalisé
 * (`normaliserStructureLibre`) et non vide : l'appelant sait, lui, si un champ vide
 * est un refus (inscription) ou une absence légitime (admin).
 */
export async function resolveStructureLibre(demandeurId: number, label: string): Promise<number> {
  const existante = await prisma.structure.findFirst({
    where: { demandeurId, label: { equals: label, mode: "insensitive" } },
    select: { id: true },
  });
  if (existante) return existante.id;
  const creee = await prisma.structure.create({
    data: { demandeurId, label },
    select: { id: true },
  });
  return creee.id;
}

// ════════════════════════════════════════════════════════════════════════════
//  Changement de structure par l'USAGER (« Mon compte »)
//
//  L'usager peut changer sa catégorie et sa structure depuis « Mon compte », à une
//  condition : n'avoir aucune réservation sur un exercice en cours. Le détail du
//  raisonnement (pourquoi c'est acceptable alors que la catégorie commande l'accès)
//  est dans `updateAffiliationAction` — mon-compte/actions.ts.
// ════════════════════════════════════════════════════════════════════════════

/**
 * L'usager a-t-il au moins une réservation sur un exercice EN COURS ?
 *
 * Deuxième condition du changement libre : les documents OPÉRATIONNELS (agenda,
 * éditions, feuilles de pointage) lisent la fiche VIVANTE — seules les statistiques
 * lisent le snapshot posé sur la réservation (bookings.structureLabel…, 2026-08-29).
 * Changer de structure alors que des séances de l'année sont déjà posées
 * réétiquetterait ces documents — une feuille de pointage de septembre afficherait
 * la nouvelle école. Tant qu'il n'y a rien à réétiqueter, le changement est sans
 * effet de bord.
 *
 * Récurrentes rattachées par `booking.periodId`, ponctuelles par le `periodId` de
 * leur CRÉNEAU (elles stockent periodId à null) — même forme que le décompte des
 * maxima.
 */
export async function aReservationSurExerciceCourant(userId: string): Promise<boolean> {
  const exoIds = await currentExerciceIdsAllServices();
  if (exoIds.length === 0) return false;
  const periodes = await prisma.period.findMany({
    where: { exerciceId: { in: exoIds } },
    select: { id: true },
  });
  const periodIds = periodes.map((p) => p.id);
  if (periodIds.length === 0) return false;
  const n = await prisma.booking.count({
    where: {
      userId,
      OR: [{ periodId: { in: periodIds } }, { slot: { periodId: { in: periodIds } } }],
    },
  });
  return n > 0;
}
