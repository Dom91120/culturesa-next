"use server";

import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Schéma LOCAL au pane « Réservations ». Volontairement plus permissif que
 * `serviceUpdateSchema` : le legacy encode le délai de réservation et le délai
 * d'auto-validation avec des valeurs négatives (jours/heures ouvrés) et de
 * grandes valeurs (≥1000 = jours calendaires / minutes). On ne modifie donc
 * pas le schéma global pour ne pas casser `service-form.tsx`.
 */
const reservationSettingsSchema = z.object({
  id: z.string().trim().min(1),
  maxReservations: z.coerce.number().int().min(1),
  maxReservationsPeriod: z.coerce.number().int().min(1),
  bookingDelay: z.coerce.number().int(),
  autoValidationDelay: z.coerce.number().int(),
  validationBloquante: z.boolean(),
});

export type ReservationSettingsInput = z.infer<typeof reservationSettingsSchema>;

/** Sauvegarde immédiate (au changement) des réglages de réservation d'un service. */
export async function updateReservationSettingsAction(
  input: ReservationSettingsInput,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = reservationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { id, ...data } = parsed.data;
  try {
    await prisma.service.update({ where: { id }, data });
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${id}/reservations`);
  return { ok: true };
}
