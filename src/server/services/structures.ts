import type { StructureInput } from "@/schemas/referentiels";
import { prisma } from "@/server/db";

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
