"use server";

import type { ActionState } from "@/lib/action-state";
import { idSchema, niveauSchema } from "@/schemas/referentiels";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/niveaux";
import { revalidatePath } from "next/cache";

const PATH = "/niveaux";

function readForm(formData: FormData) {
  const rawDemandeur = formData.get("demandeurId");
  return niveauSchema.safeParse({
    label: formData.get("label"),
    demandeurId: rawDemandeur === "" || rawDemandeur === null ? null : rawDemandeur,
    position: formData.get("position") ?? 0,
  });
}

export async function createNiveauAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await svc.createNiveau(parsed.data);
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateNiveauAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = readForm(formData);
  if (!id.success || !parsed.success) return;
  await svc.updateNiveau(id.data, parsed.data);
  revalidatePath(PATH);
}

export async function deleteNiveauAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deleteNiveau(id.data);
  revalidatePath(PATH);
}
