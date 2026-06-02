import type { ServiceUpdateInput } from "@/schemas/config";
import { prisma } from "@/server/db";

export function listServices() {
  return prisma.service.findMany({
    orderBy: [{ position: "asc" }, { label: "asc" }],
    include: { _count: { select: { slots: true, periods: true, bookings: true } } },
  });
}

export function getService(id: string) {
  return prisma.service.findUnique({ where: { id } });
}

/** Crée un service avec un id généré (svc_xxxxxxxx). */
export function createService(label: string, position: number) {
  const id = `svc_${crypto.randomUUID().slice(0, 8)}`;
  return prisma.service.create({ data: { id, label, position } });
}

export function updateService(id: string, data: ServiceUpdateInput) {
  return prisma.service.update({ where: { id }, data });
}

/** Mise à jour partielle (nom + icône) — utilisée par la modale de l'écran liste. */
export function updateServiceBasics(id: string, data: { label?: string; icon?: string | null }) {
  return prisma.service.update({ where: { id }, data });
}

export function deleteService(id: string) {
  return prisma.service.delete({ where: { id } });
}
