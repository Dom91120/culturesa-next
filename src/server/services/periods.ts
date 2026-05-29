import { prisma } from "@/server/db";
import type { PeriodInput } from "@/schemas/config";

export function listPeriods() {
  return prisma.period.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: { service: { select: { label: true } } },
  });
}

function toData(data: PeriodInput) {
  return {
    label: data.label,
    etiquette: data.etiquette ?? null,
    serviceId: data.serviceId || null,
    exerciceId: data.exerciceId ?? null,
    dateStart: data.dateStart ?? null,
    dateEnd: data.dateEnd ?? null,
    color: data.color,
    position: data.position,
    state: data.state,
  };
}

export function createPeriod(data: PeriodInput) {
  return prisma.period.create({ data: toData(data) });
}

export function updatePeriod(id: number, data: PeriodInput) {
  return prisma.period.update({ where: { id }, data: toData(data) });
}

export function deletePeriod(id: number) {
  return prisma.period.delete({ where: { id } });
}
