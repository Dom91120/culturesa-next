import { prisma } from "@/server/db";
import type { DemandeurInput } from "@/schemas/referentiels";

export function listDemandeurs() {
  return prisma.demandeur.findMany({
    orderBy: { label: "asc" },
    include: { _count: { select: { structures: true, niveaux: true, users: true } } },
  });
}

export function createDemandeur(data: DemandeurInput) {
  return prisma.demandeur.create({ data });
}

export function updateDemandeur(id: number, data: DemandeurInput) {
  return prisma.demandeur.update({ where: { id }, data });
}

export function deleteDemandeur(id: number) {
  return prisma.demandeur.delete({ where: { id } });
}
