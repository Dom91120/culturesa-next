"use server";

import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import { WEEKDAYS } from "@/server/services/manager-notice";
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
  // Notification gestionnaires (digest des auto-validations) — par service.
  mgrNoticeMode: z.enum(["none", "hours", "daily", "weekly"]),
  mgrNoticeIntervalHours: z.coerce.number().int().min(1).max(168),
  mgrNoticeHour: z.coerce.number().int().min(0).max(23),
  mgrNoticeWeekday: z.enum(WEEKDAYS),
});

export type ReservationSettingsInput = z.infer<typeof reservationSettingsSchema>;

/** Sauvegarde immédiate (au changement) des réglages de réservation d'un service. */
export async function updateReservationSettingsAction(
  input: ReservationSettingsInput,
): Promise<ActionState> {
  await requireServiceManager(input.id);
  const parsed = reservationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { id, ...data } = parsed.data;
  try {
    // À l'activation de la notification (mode ≠ none) sans curseur, on l'initialise
    // à maintenant : le premier digest ne couvrira que les auto-validations à venir.
    let mgrNoticeLastSentAt: Date | undefined;
    if (data.mgrNoticeMode !== "none") {
      const svc = await prisma.service.findUnique({
        where: { id },
        select: { mgrNoticeLastSentAt: true },
      });
      if (svc && svc.mgrNoticeLastSentAt == null) mgrNoticeLastSentAt = new Date();
    }
    await prisma.service.update({
      where: { id },
      data: { ...data, ...(mgrNoticeLastSentAt ? { mgrNoticeLastSentAt } : {}) },
    });
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${id}/reservations`);
  return { ok: true };
}
