"use server";

import type { ActionState } from "@/lib/action-state";
import { serviceCreateSchema, stringIdSchema } from "@/schemas/config";
import { prisma } from "@/server/db";
import { requireRole, requireServiceManager } from "@/server/guards";
import * as svc from "@/server/services/services";
import { revalidatePath } from "next/cache";

// Données affichées dans la modale de confirmation de suppression d'un service :
// libellé + décompte de tout ce qui partira EN CASCADE (FK onDelete: Cascade du schéma).
export type ServiceDeletionInfo = {
  label: string;
  counts: {
    bookings: number;
    slots: number;
    periods: number;
    managers: number;
    themes: number;
    demandeurSettings: number;
  };
};

export async function getServiceDeletionInfoAction(
  rawId: string,
): Promise<{ ok: true; info: ServiceDeletionInfo } | { ok: false; error: string }> {
  const id = stringIdSchema.safeParse(rawId);
  if (!id.success) return { ok: false, error: "Service introuvable" };
  await requireServiceManager(id.data);
  const service = await prisma.service.findUnique({
    where: { id: id.data },
    select: { label: true },
  });
  if (!service) return { ok: false, error: "Service introuvable" };
  const [bookings, slots, periods, managers, themes, demandeurSettings] = await Promise.all([
    prisma.booking.count({ where: { serviceId: id.data } }),
    prisma.slot.count({ where: { serviceId: id.data } }),
    prisma.period.count({ where: { serviceId: id.data } }),
    prisma.serviceManager.count({ where: { serviceId: id.data } }),
    prisma.serviceTheme.count({ where: { serviceId: id.data } }),
    prisma.serviceDemandeurSettings.count({ where: { serviceId: id.data } }),
  ]);
  return {
    ok: true,
    info: {
      label: service.label,
      counts: { bookings, slots, periods, managers, themes, demandeurSettings },
    },
  };
}

// Création / édition depuis la modale de l'écran liste (nom + icône uniquement,
// le reste de la config se fait via « Gérer » → page détail). Pas de redirection :
// on reste sur la liste comme l'ancienne version PHP.
export async function saveServiceFromModalAction(input: {
  id?: string;
  label: string;
  icon: string | null;
}): Promise<ActionState> {
  // Édition d'un service existant → réservé à ses gestionnaires (ou admin) ; création
  // d'un nouveau service → tout gestionnaire (il ne pourra toutefois pas l'administrer
  // tant qu'un admin ne l'a pas rattaché à sa liste).
  if (input.id) await requireServiceManager(input.id);
  else await requireRole("gestionnaire");
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
  for (const raw of ids) {
    const id = stringIdSchema.safeParse(raw);
    if (!id.success) continue;
    // Chaque service supprimé doit être géré par l'usager (ou admin).
    await requireServiceManager(id.data);
    await svc.deleteService(id.data);
  }
  revalidatePath("/services");
  return { ok: true };
}
