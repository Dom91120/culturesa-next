"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";

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
 * Bascule « Créneaux récurrents (Modèle de période) » (Service.recurrentMode).
 * GLOBAL au service : pilote la vue Modèle de l'agenda admin et conditionne
 * l'alternance A/B. Désactiver ne touche ni créneaux ni réservations existants.
 */
export async function setRecurrentModeAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  await prisma.service.update({
    where: { id: serviceId },
    data: { recurrentMode: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Bascule « Alternance Semaine A / B » (Service.semaineAb). GLOBAL au service ;
 * sans effet tant que recurrentMode est désactivé (l'A/B ne concerne que les
 * créneaux récurrents).
 */
export async function setSemaineAbAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  await prisma.service.update({
    where: { id: serviceId },
    data: { semaineAb: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}
