"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { APP_URL_KEY, setConfig } from "@/server/config";
import { requireRole } from "@/server/guards";
import { countSchoolHolidays, refreshSchoolHolidaysFromGov } from "@/server/services/holidays";

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

// URL http(s) valide (ou chaîne vide = pas de lien) : la valeur est injectée dans le
// lien « Portail CultuRésa » des e-mails — pas de schéma exotique (javascript:, data:).
const appUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "URL invalide (http(s) attendu).");

/**
 * Enregistre l'URL publique de l'application (clé app_config `app.url`), utilisée pour le
 * lien « Portail CultuRésa » des e-mails. Vide = pas de lien (repli sur les variables
 * d'environnement). Le slash final est retiré.
 */
export async function setAppUrlAction(url: string): Promise<ActionState> {
  await requireRole("administrateur");
  const parsed = appUrlSchema.safeParse(url);
  if (!parsed.success) return { ok: false, error: "URL invalide." };
  await setConfig(APP_URL_KEY, parsed.data.replace(/\/$/, ""));
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
