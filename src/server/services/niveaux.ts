import type { NiveauInput } from "@/schemas/referentiels";
import { prisma } from "@/server/db";

export function listNiveaux() {
  return prisma.niveau.findMany({
    orderBy: [{ position: "asc" }, { label: "asc" }],
    include: { demandeur: { select: { label: true } } },
  });
}

export function createNiveau(data: NiveauInput) {
  return prisma.niveau.create({
    data: { label: data.label, position: data.position, demandeurId: data.demandeurId ?? null },
  });
}

export function updateNiveau(id: number, data: NiveauInput) {
  return prisma.niveau.update({
    where: { id },
    data: { label: data.label, position: data.position, demandeurId: data.demandeurId ?? null },
  });
}

export function deleteNiveau(id: number) {
  return prisma.niveau.delete({ where: { id } });
}
