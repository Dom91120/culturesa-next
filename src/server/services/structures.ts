import { prisma } from "@/server/db";
import type { StructureInput } from "@/schemas/referentiels";

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
