"use server";

import type { ActionState } from "@/lib/action-state";
import { serviceCreateSchema, serviceUpdateSchema, stringIdSchema } from "@/schemas/config";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/services";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// Création / édition depuis la modale de l'écran liste (nom + icône uniquement,
// le reste de la config se fait via « Gérer » → page détail). Pas de redirection :
// on reste sur la liste comme l'ancienne version PHP.
export async function saveServiceFromModalAction(input: {
  id?: string;
  label: string;
  icon: string | null;
}): Promise<ActionState> {
  await requireRole("gestionnaire");
  const parsed = serviceCreateSchema.safeParse({ label: input.label });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const icon = input.icon?.trim() ? input.icon.trim().slice(0, 16) : null;

  if (input.id) {
    const id = stringIdSchema.safeParse(input.id);
    if (!id.success) return { ok: false, error: "Service introuvable" };
    await svc.updateServiceBasics(id.data, { label: parsed.data.label, icon });
  } else {
    const created = await svc.createService(parsed.data.label, 0);
    if (icon) await svc.updateServiceBasics(created.id, { icon });
  }
  revalidatePath("/services");
  return { ok: true };
}

// Suppression groupée depuis la barre d'actions (la sélection est unique dans
// l'UI, mais on accepte une liste pour coller au flux « cocher → Supprimer »).
export async function deleteServicesAction(ids: string[]): Promise<ActionState> {
  await requireRole("gestionnaire");
  for (const raw of ids) {
    const id = stringIdSchema.safeParse(raw);
    if (id.success) await svc.deleteService(id.data);
  }
  revalidatePath("/services");
  return { ok: true };
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
