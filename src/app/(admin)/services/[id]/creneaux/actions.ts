"use server";

import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import {
  deleteSlots,
  saveRecurringSlots,
  saveUniqueSlots,
  setSlotDemandeurs,
  setSlotsState,
} from "@/server/services/slots";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Heure « HH:MM » OU chaîne vide (créneau « journée entière », cf. legacy).
const TIME_RE = /^(\d{2}:\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const recurSlotSchema = z.object({
  id: z.string().nullable(),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  weeks: z.string(),
  cap: z.record(
    z.enum(["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]),
    z.number().int().nullable(),
  ),
  demandeurIds: z.array(z.number().int()),
});

const uniqueSlotSchema = z.object({
  id: z.string().nullable(),
  parentSlotId: z.string().nullable().optional(),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  slotDate: z.string().regex(DATE_RE).nullable(),
  capacity: z.number().int().nullable(),
});

function revalidate(serviceId: string) {
  revalidatePath(`/services/${serviceId}/creneaux`);
}

export async function saveRecurringSlotsAction(
  serviceId: string,
  periodId: number,
  slots: z.infer<typeof recurSlotSchema>[],
) {
  await requireRole("gestionnaire");
  const parsed = z.array(recurSlotSchema).safeParse(slots);
  if (!parsed.success) return { ok: false as const, error: "Données invalides" };
  const res = await saveRecurringSlots(serviceId, periodId, parsed.data);
  if (!res.ok) return res;
  revalidate(serviceId);
  return { ok: true as const };
}

export async function saveUniqueSlotsAction(
  serviceId: string,
  slots: z.infer<typeof uniqueSlotSchema>[],
) {
  await requireRole("gestionnaire");
  const parsed = z.array(uniqueSlotSchema).safeParse(slots);
  if (!parsed.success) return { ok: false as const, error: "Données invalides" };
  const res = await saveUniqueSlots(serviceId, parsed.data);
  if (!res.ok) return res;
  revalidate(serviceId);
  return { ok: true as const };
}

export async function deleteSlotsAction(serviceId: string, ids: string[]) {
  await requireRole("gestionnaire");
  const res = await deleteSlots(serviceId, ids);
  if (!res.ok) return res;
  revalidate(serviceId);
  return { ok: true as const };
}

export async function setSlotsStateAction(serviceId: string, ids: string[], state: string) {
  await requireRole("gestionnaire");
  const res = await setSlotsState(ids, state);
  if (!res.ok) return res;
  revalidate(serviceId);
  return { ok: true as const };
}

export async function setSlotDemandeursAction(
  serviceId: string,
  slotId: string,
  demandeurIds: number[],
) {
  await requireRole("gestionnaire");
  const parsed = z.array(z.number().int()).safeParse(demandeurIds);
  if (!parsed.success) return { ok: false as const, error: "Données invalides" };
  const res = await setSlotDemandeurs(slotId, parsed.data);
  if (!res.ok) return res;
  revalidate(serviceId);
  return { ok: true as const };
}

export async function saveServiceSlotDefaultsAction(
  serviceId: string,
  defaults: { recurDuration?: number; ponctDuration?: number; ponctCapacity?: number },
) {
  await requireRole("gestionnaire");
  const schema = z.object({
    recurDuration: z.number().int().positive().optional(),
    ponctDuration: z.number().int().positive().optional(),
    ponctCapacity: z.number().int().min(0).optional(),
  });
  const parsed = schema.safeParse(defaults);
  if (!parsed.success) return { ok: false as const, error: "Données invalides" };
  await prisma.service.update({ where: { id: serviceId }, data: parsed.data });
  revalidate(serviceId);
  return { ok: true as const };
}
