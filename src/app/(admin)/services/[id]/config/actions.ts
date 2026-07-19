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
