"use server";

import { revalidatePath } from "next/cache";
import { demandeurSchema, idSchema } from "@/schemas/referentiels";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/demandeurs";

const PATH = "/demandeurs";

function readForm(formData: FormData) {
  return demandeurSchema.safeParse({
    label: formData.get("label"),
    openOnSchoolHolidays: formData.get("openOnSchoolHolidays") === "on",
  });
}

export async function createDemandeurAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await svc.createDemandeur(parsed.data);
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateDemandeurAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = readForm(formData);
  if (!id.success || !parsed.success) return;
  await svc.updateDemandeur(id.data, parsed.data);
  revalidatePath(PATH);
}

export async function deleteDemandeurAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deleteDemandeur(id.data);
  revalidatePath(PATH);
}
