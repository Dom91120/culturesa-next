"use server";

import type { ActionState } from "@/lib/action-state";
import { setConfig } from "@/server/config";
import { requireRole } from "@/server/guards";
import { countSchoolHolidays, refreshSchoolHolidaysFromGov } from "@/server/services/holidays";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const zoneSchema = z.enum(["A", "B", "C"]);

const refreshSecondsSchema = z.coerce.number().int().min(0).max(3600);

/**
 * Enregistre l'état du « Mode debug » (clé app_config `debug.mode`). Source de vérité
 * SERVEUR : les écrans (ex. Réservations) la lisent côté serveur → pas d'état client
 * « collé ».
 */
export async function setDebugModeAction(on: boolean): Promise<ActionState> {
  await requireRole("administrateur");
  await setConfig("debug.mode", on ? "1" : "0");
  revalidatePath("/configuration");
  return { ok: true };
}

/**
 * Enregistre l'intervalle d'auto-rafraîchissement de la page Réservations
 * (clé app_config `reservations.autoRefreshSeconds`). 0 = désactivé.
 */
export async function setReservationsRefreshAction(seconds: number): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = refreshSecondsSchema.safeParse(seconds);
  if (!parsed.success) return { ok: false, error: "Valeur invalide." };
  await setConfig("reservations.autoRefreshSeconds", String(parsed.data));
  revalidatePath("/configuration");
  return { ok: true };
}

/**
 * Enregistre l'intervalle d'auto-rafraîchissement de l'agenda admin
 * (clé app_config `agenda.autoRefreshSeconds`). 0 = désactivé.
 */
export async function setAgendaRefreshAction(seconds: number): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = refreshSecondsSchema.safeParse(seconds);
  if (!parsed.success) return { ok: false, error: "Valeur invalide." };
  await setConfig("agenda.autoRefreshSeconds", String(parsed.data));
  revalidatePath("/configuration");
  return { ok: true };
}

/** Enregistre la zone de vacances scolaires (clé app_config `school.zone`). */
export async function setSchoolZoneAction(zone: string): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = zoneSchema.safeParse(zone);
  if (!parsed.success) return { ok: false, error: "Zone invalide." };
  await setConfig("school.zone", parsed.data);
  revalidatePath("/configuration");
  return { ok: true };
}

type RefreshResult = ActionState & { imported?: number; count?: number };

/** Rafraîchit les vacances scolaires depuis l'open data education.gouv.fr. */
export async function refreshSchoolHolidaysAction(zone: string): Promise<RefreshResult> {
  await requireRole("administrateur");
  const parsed = zoneSchema.safeParse(zone);
  if (!parsed.success) return { ok: false, error: "Zone invalide." };
  try {
    const imported = await refreshSchoolHolidaysFromGov(parsed.data);
    const count = await countSchoolHolidays(parsed.data);
    revalidatePath("/configuration");
    return { ok: true, imported, count };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Échec du rafraîchissement.";
    return { ok: false, error: msg };
  }
}
