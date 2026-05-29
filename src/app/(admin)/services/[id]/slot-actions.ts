"use server";

import { revalidatePath } from "next/cache";
import { slotSchema, stringIdSchema } from "@/schemas/config";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/slots";

function readForm(formData: FormData) {
  const empty = (k: string) => {
    const v = formData.get(k);
    return v === "" || v === null ? null : v;
  };
  return slotSchema.safeParse({
    serviceId: formData.get("serviceId"),
    slotType: formData.get("slotType"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    slotDate: empty("slotDate"),
    capacity: empty("capacity"),
    periodId: empty("periodId"),
    state: formData.get("state"),
  });
}

function revalidate(serviceId: FormDataEntryValue | null) {
  if (typeof serviceId === "string") revalidatePath(`/services/${serviceId}`);
}

export async function createSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = readForm(formData);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  await svc.createSlot(parsed.data);
  revalidate(formData.get("serviceId"));
  return { ok: true };
}

export async function updateSlotAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = stringIdSchema.safeParse(formData.get("id"));
  const parsed = readForm(formData);
  if (!id.success || !parsed.success) return;
  await svc.updateSlot(id.data, parsed.data);
  revalidate(formData.get("serviceId"));
}

export async function deleteSlotAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = stringIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deleteSlot(id.data);
  revalidate(formData.get("serviceId"));
}
