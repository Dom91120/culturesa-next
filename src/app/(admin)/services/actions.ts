"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { serviceCreateSchema, stringIdSchema } from "@/schemas/config";
import { AUDIT, recordAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import * as svc from "@/server/services/services";

// Création / édition depuis la modale de l'écran liste (nom + icône uniquement,
// le reste de la config se fait via « Gérer » → page détail). Pas de redirection :
// on reste sur la liste comme l'ancienne version PHP.
export async function saveServiceFromModalAction(input: {
  id?: string;
  label: string;
  icon: string | null;
}): Promise<ActionState> {
  // Référentiel des services (onglet Administration) → réservé aux administrateurs.
  await requireRole("administrateur");
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
  revalidatePath("/configuration");
  return { ok: true };
}

// Suppression groupée depuis la barre d'actions (la sélection est unique dans
// l'UI, mais on accepte une liste pour coller au flux « cocher → Supprimer »).
export async function deleteServicesAction(ids: string[]): Promise<ActionState> {
  // Référentiel des services (onglet Administration) → réservé aux administrateurs.
  await requireRole("administrateur");
  for (const raw of ids) {
    const id = stringIdSchema.safeParse(raw);
    if (!id.success) continue;
    // Libellé lu AVANT suppression : un identifiant technique seul serait
    // illisible dans le journal une fois le service disparu (constat BAC4).
    const label = (
      await prisma.service.findUnique({ where: { id: id.data }, select: { label: true } })
    )?.label;
    await svc.deleteService(id.data);
    // Emporte créneaux et réservations : destruction en cascade, jamais anodine.
    await recordAudit(AUDIT.SERVICE_DELETED, { target: label ?? id.data });
  }
  revalidatePath("/configuration");
  return { ok: true };
}
