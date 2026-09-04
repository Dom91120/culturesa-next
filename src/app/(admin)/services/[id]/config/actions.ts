"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import { WEEKDAYS } from "@/server/services/manager-notice";

/**
 * Bascule « Jauge — prise en compte des accompagnants » (Service.gaugeAccompagnants).
 * true = les accompagnants consomment des places dans la jauge (comportement historique).
 */
export async function setGaugeAccompagnantsAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  await prisma.service.update({
    where: { id: serviceId },
    data: { gaugeAccompagnants: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Bascule « Alerte plus de place » (Service.fullPeriodNotice) : modale informant
 * l'usager, à l'arrivée sur l'agenda ou sur une période, que plus aucune occurrence
 * de la période affichée n'est réservable.
 */
export async function setFullPeriodNoticeAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  await prisma.service.update({
    where: { id: serviceId },
    data: { fullPeriodNotice: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  return { ok: true };
}

/**
 * Bascule « Absences prévenues » (Service.absencePrevenue) : signalement d'absence à
 * l'avance par l'usager (agenda) ou le gestionnaire (fiche réservation).
 */
export async function setAbsencePrevenueAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  await prisma.service.update({
    where: { id: serviceId },
    data: { absencePrevenue: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Texte personnalisé de l'alerte « plus de place » (Service.fullPeriodNoticeText) :
 * remplace le message par défaut de la modale ; vide → retour au texte par défaut.
 */
export async function setFullPeriodNoticeTextAction(
  serviceId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const parsed = z.string().max(600, "Texte trop long (600 caractères max)").safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await prisma.service.update({
    where: { id: serviceId },
    data: { fullPeriodNoticeText: parsed.data.trim() || null },
  });
  revalidatePath(`/services/${serviceId}/config`);
  return { ok: true };
}

/**
 * Réglages « Validation & auto-validation » (service-globaux), édités dans
 * « Paramètres globaux du service ». Schéma volontairement permissif sur les délais :
 * le legacy encode l'auto-validation avec des valeurs négatives (heures/jours ouvrés)
 * et de grandes valeurs (≥1000 = calendaire). Portés par le SERVICE.
 */
const validationSettingsSchema = z.object({
  serviceId: z.string().trim().min(1),
  validationBloquante: z.boolean(),
  autoValidationDelay: z.coerce.number().int(),
  // Notification gestionnaires (digest des auto-validations).
  mgrNoticeMode: z.enum(["none", "each", "hours", "daily", "weekly"]),
  mgrNoticeIntervalHours: z.coerce.number().int().min(1).max(168),
  mgrNoticeHour: z.coerce.number().int().min(0).max(23),
  mgrNoticeWeekday: z.enum(WEEKDAYS),
});

export type ValidationSettingsInput = z.infer<typeof validationSettingsSchema>;

/** Sauvegarde (au changement, débouncé côté client) des réglages de validation. */
export async function updateServiceValidationSettingsAction(
  input: ValidationSettingsInput,
): Promise<ActionState> {
  await requireServiceManager(input.serviceId);
  const parsed = validationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { serviceId, ...data } = parsed.data;
  try {
    // À l'activation de la notification (mode ≠ none) sans curseur, on l'initialise
    // à maintenant : le premier digest ne couvrira que les auto-validations à venir.
    let mgrNoticeLastSentAt: Date | undefined;
    if (data.mgrNoticeMode !== "none") {
      const svc = await prisma.service.findUnique({
        where: { id: serviceId },
        select: { mgrNoticeLastSentAt: true },
      });
      if (svc && svc.mgrNoticeLastSentAt == null) mgrNoticeLastSentAt = new Date();
    }
    await prisma.service.update({
      where: { id: serviceId },
      data: { ...data, ...(mgrNoticeLastSentAt ? { mgrNoticeLastSentAt } : {}) },
    });
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}
