"use server";

import { structureSchema } from "@/schemas/referentiels";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/structures";
import { revalidatePath } from "next/cache";

// Actions typées (référentiel Structures en modale, mode tampon). Une structure est
// rattachée à un demandeur (demandeurId obligatoire).

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: number } | { ok: false; error: string };

export async function createStructureAction(input: {
  label: string;
  demandeurId: number;
}): Promise<CreateResult> {
  await requireRole("gestionnaire");
  const parsed = structureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const created = await svc.createStructure(parsed.data);
  revalidatePath("/configuration");
  return { ok: true, id: created.id };
}

export async function updateStructureAction(
  id: number,
  input: { label: string; demandeurId: number },
): Promise<Result> {
  await requireRole("gestionnaire");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Structure introuvable" };
  const parsed = structureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  await svc.updateStructure(id, parsed.data);
  revalidatePath("/configuration");
  return { ok: true };
}

export async function deleteStructureAction(id: number): Promise<Result> {
  await requireRole("gestionnaire");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Structure introuvable" };
  await svc.deleteStructure(id);
  revalidatePath("/configuration");
  return { ok: true };
}
