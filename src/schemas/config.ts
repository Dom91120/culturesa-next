import { z } from "zod";

/** Schémas de validation — config métier (services, périodes, créneaux). */

const _TIME = /^\d{2}:\d{2}$/;
export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

// ── Services ──
export const serviceCreateSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
});

/** Identifiant texte (services/slots). */
export const stringIdSchema = z.string().trim().min(1).max(64);
