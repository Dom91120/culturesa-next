import { prisma } from "@/server/db";
import type { SlotInput } from "@/schemas/config";

export function listSlotsForService(serviceId: string) {
  return prisma.slot.findMany({
    where: { serviceId },
    orderBy: [{ slotType: "asc" }, { startTime: "asc" }],
    include: {
      period: { select: { label: true } },
      demandeurs: { select: { demandeurId: true } },
    },
  });
}

function toData(data: SlotInput) {
  return {
    serviceId: data.serviceId,
    slotType: data.slotType,
    startTime: data.startTime,
    endTime: data.endTime,
    slotDate: data.slotType === "unique" ? (data.slotDate ?? null) : null,
    capacity: data.capacity ?? null,
    periodId: data.periodId ?? null,
    state: data.state,
  };
}

export function createSlot(data: SlotInput) {
  const id = `slot_${crypto.randomUUID().slice(0, 8)}`;
  return prisma.slot.create({ data: { id, ...toData(data) } });
}

export function updateSlot(id: string, data: SlotInput) {
  return prisma.slot.update({ where: { id }, data: toData(data) });
}

export function deleteSlot(id: string) {
  return prisma.slot.delete({ where: { id } });
}
