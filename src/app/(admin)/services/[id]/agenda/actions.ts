"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";

const idSchema = z.coerce.number().int().positive();

export async function setBookingValidatedAction(
  bookingId: number,
  serviceId: string,
  validated: boolean,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { validated } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

export async function setBookingPointageAction(
  bookingId: number,
  serviceId: string,
  pointage: "present" | "absent" | null,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { pointage } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

export async function deleteBookingAdminAction(bookingId: number, serviceId: string) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.delete({ where: { id: id.data } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

/** Déplace une réservation vers un autre jour / créneau (glisser-déposer). */
export async function moveBookingAction(
  bookingId: number,
  serviceId: string,
  dayKey: string,
  slotId: string,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({
    where: { id: id.data },
    // auto_validate_from réinitialisé à NOW() sur un déplacement (cf. logique d'origine).
    data: { dayKey, slotId, autoValidateFrom: new Date() },
  });
  revalidatePath(`/services/${serviceId}/agenda`);
}

const createSchema = z.object({
  serviceId: z.string().min(1),
  slotId: z.string().min(1),
  periodId: z.coerce.number().int().positive(),
  dayKey: z.string().min(1),
  userId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  theme: z.string().trim().max(255).default(""),
  week: z.enum(["", "A", "B"]).default(""),
});

/** Crée une réservation récurrente (clic sur un créneau vide de l'agenda). */
export async function createRecurringBookingAction(input: {
  serviceId: string;
  slotId: string;
  periodId: number;
  dayKey: string;
  userId: string;
  enfants: number;
  theme: string;
  week: "" | "A" | "B";
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  try {
    await prisma.booking.create({
      data: {
        bookingType: "recurring",
        userId: d.userId,
        serviceId: d.serviceId,
        slotId: d.slotId,
        periodId: d.periodId,
        dayKey: d.dayKey,
        week: d.week,
        enfants: d.enfants,
        themeLabel: d.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}
