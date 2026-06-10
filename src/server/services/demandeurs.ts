import { prisma } from "@/server/db";

export function listDemandeurs() {
  return prisma.demandeur.findMany({
    orderBy: { label: "asc" },
    include: { _count: { select: { structures: true, niveaux: true, users: true } } },
  });
}
