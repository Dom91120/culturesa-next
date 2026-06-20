"use server";

import { niveauSchema } from "@/schemas/referentiels";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/niveaux";
import { revalidatePath } from "next/cache";

// Actions typées (référentiel Niveaux en modale, mode tampon). Un niveau a une position
// d'ordre et peut être rattaché à un demandeur (demandeurId optionnel).

type NiveauData = { label: string; demandeurId: number | null; position: number };
type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: number } | { ok: false; error: string };

export async function createNiveauAction(input: NiveauData): Promise<CreateResult> {
  await requireRole("administrateur");
  const parsed = niveauSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const created = await svc.createNiveau(parsed.data);
  revalidatePath("/configuration");
  return { ok: true, id: created.id };
}

export async function updateNiveauAction(id: number, input: NiveauData): Promise<Result> {
  await requireRole("administrateur");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Niveau introuvable" };
  const parsed = niveauSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  await svc.updateNiveau(id, parsed.data);
  revalidatePath("/configuration");
  return { ok: true };
}

export async function deleteNiveauAction(id: number): Promise<Result> {
  await requireRole("administrateur");
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Niveau introuvable" };
  await svc.deleteNiveau(id);
  revalidatePath("/configuration");
  return { ok: true };
}
