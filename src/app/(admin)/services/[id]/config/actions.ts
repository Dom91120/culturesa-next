"use server";

import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { revalidatePath } from "next/cache";

/**
 * Bascule « Jauge — prise en compte des accompagnants » (Service.gaugeAccompagnants).
 * true = les accompagnants consomment des places dans la jauge (comportement historique).
 */
export async function setGaugeAccompagnantsAction(
  serviceId: string,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  await prisma.service.update({
    where: { id: serviceId },
    data: { gaugeAccompagnants: value },
  });
  revalidatePath(`/services/${serviceId}/config`);
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}
