"use server";

import type { ActionState } from "@/lib/action-state";
import { idSchema, structureSchema } from "@/schemas/referentiels";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/structures";
import { revalidatePath } from "next/cache";

const PATH = "/structures";

function readForm(formData: FormData) {
  return structureSchema.safeParse({
    demandeurId: formData.get("demandeurId"),
    label: formData.get("label"),
  });
}

export async function createStructureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await svc.createStructure(parsed.data);
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateStructureAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = readForm(formData);
  if (!id.success || !parsed.success) return;
  await svc.updateStructure(id.data, parsed.data);
  revalidatePath(PATH);
}

export async function deleteStructureAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deleteStructure(id.data);
  revalidatePath(PATH);
}
