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

/**
 * Crée un service avec un id séquentiel `svc_00N` (max existant + 1, sur 3 chiffres),
 * aligné sur la convention du seed (svc_001, svc_002…). Les ids non numériques
 * éventuels (anciens `svc_<hex>`) sont ignorés dans le calcul du max.
 */
export async function createService(label: string, position: number) {
  const services = await prisma.service.findMany({ select: { id: true } });
  const maxN = services.reduce((m, s) => {
    const match = /^svc_(\d+)$/.exec(s.id);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const id = `svc_${String(maxN + 1).padStart(3, "0")}`;
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
