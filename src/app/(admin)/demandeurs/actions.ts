"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";

const rowsSchema = z.array(
  z.object({
    id: z.number().int().positive().nullable(),
    label: z.string().trim().min(1).max(100),
    openOnSchoolHolidays: z.boolean(),
  }),
);

export type DemandeurRow = z.infer<typeof rowsSchema>[number];

/**
 * Sauvegarde groupée des demandeurs (comme l'original : un seul "Enregistrer").
 * Réconcilie : crée les nouveaux, met à jour les existants, supprime ceux retirés.
 */
export async function saveDemandeursAction(rows: DemandeurRow[]): Promise<ActionState> {
  await requireRole("gestionnaire");

  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: "Chaque demandeur doit avoir un libellé." };
  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.demandeur.findMany({ select: { id: true } });
    const keepIds = new Set(data.filter((r) => r.id != null).map((r) => r.id));
    const toDelete = existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id);
    if (toDelete.length) {
      await tx.demandeur.deleteMany({ where: { id: { in: toDelete } } });
    }
    for (const r of data) {
      if (r.id != null) {
        await tx.demandeur.update({
          where: { id: r.id },
          data: { label: r.label, openOnSchoolHolidays: r.openOnSchoolHolidays },
        });
      } else {
        await tx.demandeur.create({
          data: { label: r.label, openOnSchoolHolidays: r.openOnSchoolHolidays },
        });
      }
    }
  });

  revalidatePath("/demandeurs");
  return { ok: true };
}
