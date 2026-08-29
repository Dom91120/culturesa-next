"use server";

import { revalidatePath } from "next/cache";
import { structureSchema } from "@/schemas/referentiels";
import { normaliserStructureLibre } from "@/schemas/user";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/structures";

// Actions typées (référentiel Structures en modale, mode tampon). Une structure est
// rattachée à un demandeur (demandeurId obligatoire).

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: number } | { ok: false; error: string };

const MESSAGE_DOUBLON = "Cette structure existe déjà dans cette catégorie.";

export async function createStructureAction(input: {
  label: string;
  demandeurId: number;
}): Promise<CreateResult> {
  await requireRole("administrateur");
  // Espaces normalisés AVANT enregistrement (même règle que la saisie libre) : deux
  // libellés identiques à l'œil ne doivent pas pouvoir cohabiter dans le référentiel.
  const parsed = structureSchema.safeParse({
    ...input,
    label: normaliserStructureLibre(input.label),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  if (await svc.structureEnDoublon(parsed.data.demandeurId, parsed.data.label)) {
    return { ok: false, error: MESSAGE_DOUBLON };
  }
  const created = await svc.createStructure(parsed.data);
  revalidatePath("/configuration");
  return { ok: true, id: created.id };
}

export async function updateStructureAction(
  id: number,
  input: { label: string; demandeurId: number },
): Promise<Result> {
  await requireRole("administrateur");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Structure introuvable" };
  const parsed = structureSchema.safeParse({
    ...input,
    label: normaliserStructureLibre(input.label),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  // La ligne éditée est exclue du rapprochement : le renommage vers soi-même
  // (changement de casse, par exemple) reste permis.
  if (await svc.structureEnDoublon(parsed.data.demandeurId, parsed.data.label, id)) {
    return { ok: false, error: MESSAGE_DOUBLON };
  }
  await svc.updateStructure(id, parsed.data);
  revalidatePath("/configuration");
  return { ok: true };
}

export async function deleteStructureAction(id: number): Promise<Result> {
  await requireRole("administrateur");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Structure introuvable" };
  await svc.deleteStructure(id);
  revalidatePath("/configuration");
  return { ok: true };
}
