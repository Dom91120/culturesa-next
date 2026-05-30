"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serviceCreateSchema, serviceUpdateSchema, stringIdSchema } from "@/schemas/config";
import type { ActionState } from "@/lib/action-state";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/services";

export async function createServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = serviceCreateSchema.safeParse({ label: formData.get("label") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const created = await svc.createService(parsed.data.label, 0);
  revalidatePath("/services");
  redirect(`/services/${created.id}`);
}

export async function updateServiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole("gestionnaire");
  const id = stringIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Service introuvable" };

  const parsed = serviceUpdateSchema.safeParse({
    label: formData.get("label"),
    position: formData.get("position"),
    maxReservations: formData.get("maxReservations"),
    maxReservationsPeriod: formData.get("maxReservationsPeriod"),
    activeDays: formData.getAll("activeDays"),
    ponctDuration: formData.get("ponctDuration"),
    ponctCapacity: formData.get("ponctCapacity"),
    recurDuration: formData.get("recurDuration"),
    recurCapacity: formData.get("recurCapacity"),
    morningStart: formData.get("morningStart"),
    morningEnd: formData.get("morningEnd"),
    afternoonStart: formData.get("afternoonStart"),
    afternoonEnd: formData.get("afternoonEnd"),
    icon: (formData.get("icon") as string) || null,
    bookingDelay: formData.get("bookingDelay"),
    openOnHolidays: formData.get("openOnHolidays") === "on",
    showPreviousExercices: formData.get("showPreviousExercices") === "on",
    semaineAb: formData.get("semaineAb") === "on",
    themesMode: formData.get("themesMode"),
    autoValidationDelay: formData.get("autoValidationDelay"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  await svc.updateService(id.data, parsed.data);
  revalidatePath(`/services/${id.data}`);
  revalidatePath("/services");
  return { ok: true };
}

export async function deleteServiceAction(formData: FormData) {
  await requireRole("gestionnaire");
  const id = stringIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await svc.deleteService(id.data);
  revalidatePath("/services");
  redirect("/services");
}
