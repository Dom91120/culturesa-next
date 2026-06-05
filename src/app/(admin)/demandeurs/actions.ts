"use server";

import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// Actions par-ligne (create / update / delete) pour un autosave sûr de la liste
// des demandeurs : pas de réconciliation globale (qui supprimerait par absence).

const rowSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(100),
  openOnSchoolHolidays: z.boolean(),
});

type CreateResult = { ok: true; id: number } | { ok: false; error: string };
type Result = { ok: true } | { ok: false; error: string };

export async function createDemandeurAction(input: {
  label: string;
  openOnSchoolHolidays: boolean;
}): Promise<CreateResult> {
  await requireRole("gestionnaire");
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const created = await prisma.demandeur.create({
    data: { label: parsed.data.label, openOnSchoolHolidays: parsed.data.openOnSchoolHolidays },
    select: { id: true },
  });
  revalidatePath("/demandeurs");
  return { ok: true, id: created.id };
}

export async function updateDemandeurAction(
  id: number,
  input: { label: string; openOnSchoolHolidays: boolean },
): Promise<Result> {
  await requireRole("gestionnaire");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Demandeur introuvable" };
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  await prisma.demandeur.update({
    where: { id },
    data: { label: parsed.data.label, openOnSchoolHolidays: parsed.data.openOnSchoolHolidays },
  });
  revalidatePath("/demandeurs");
  return { ok: true };
}

/**
 * Supprime un demandeur. Les dépendances suivent les FK du schéma :
 * structures / slot_demandeurs / service_demandeur_settings en cascade,
 * users.demandeurId et niveaux.demandeurId remis à NULL.
 */
export async function deleteDemandeurAction(id: number): Promise<Result> {
  await requireRole("gestionnaire");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Demandeur introuvable" };
  await prisma.demandeur.delete({ where: { id } });
  revalidatePath("/demandeurs");
  return { ok: true };
}
