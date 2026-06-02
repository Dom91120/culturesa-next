"use server";

import type { ActionState } from "@/lib/action-state";
import { setConfig } from "@/server/config";
import { getSession, requireRole } from "@/server/guards";
import { anonymizeInactive, markDeletionNotice } from "@/server/services/rgpd";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/** État enrichi d'un compteur (comme `imported` dans configuration/actions.ts). */
type CountResult = ActionState & { count?: number };

const yearsSchema = z.coerce.number().int().min(0).max(50);

/** Enregistre la durée de rétention RGPD (clé app_config `rgpd.retentionYears`). */
export async function setRetentionYearsAction(years: number): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = yearsSchema.safeParse(years);
  if (!parsed.success) return { ok: false, error: "Valeur invalide (0–50)." };
  await setConfig("rgpd.retentionYears", String(parsed.data));
  revalidatePath("/rgpd");
  return { ok: true };
}

/** Envoie le préavis de suppression aux comptes ciblés (éligibles sans préavis). */
export async function sendInactivityNoticesAction(ids: string[]): Promise<CountResult> {
  await requireRole("administrateur");
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Aucun compte cible." };
  const count = await markDeletionNotice(ids);
  revalidatePath("/rgpd");
  return { ok: true, count };
}

/** Anonymise les comptes ciblés réellement éligibles (préavis ≥ 30 jours). */
export async function anonymizeInactiveAction(ids: string[]): Promise<CountResult> {
  await requireRole("administrateur");
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "Aucun compte cible." };
  const session = await getSession();
  const actorId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const count = await anonymizeInactive(ids, actorId);
  revalidatePath("/rgpd");
  return { ok: true, count };
}
