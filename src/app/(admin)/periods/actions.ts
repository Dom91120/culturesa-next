"use server";

import { revalidatePath } from "next/cache";
import { periodSchema } from "@/schemas/config";
import { idSchema } from "@/schemas/referentiels";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/periods";

const PATH = "/periods";

function readForm(formData: FormData) {
  const empty = (k: string) => {
    const v = formData.get(k);
    return v === "" || v === null ? null : v;
  };
  return periodSchema.safeParse({
    label: formData.get("label"),
    etiquette: empty("etiquette"),
    serviceId: empty("serviceId"),
    exerciceId: empty("exerciceId"),
    dateStart: empty("dateStart"),
    dateEnd: empty("dateEnd"),
    color: formData.get("color") || "#6dceaa",
    position: formData.get("position") ?? 0,
    state: formData.get("state") || "actif",
  });
}

export async function createPeriodAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await svc.createPeriod(parsed.data);
  revalidatePath(PATH);
  return { ok: true };
}

export async function updatePeriodAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = readForm(formData);
  if (!id.success || !parsed.success) return;
  await svc.updatePeriod(id.data, parsed.data);
  revalidatePath(PATH);
}

export async function deletePeriodAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deletePeriod(id.data);
  revalidatePath(PATH);
}
