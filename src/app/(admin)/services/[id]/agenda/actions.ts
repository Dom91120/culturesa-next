"use server";

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
