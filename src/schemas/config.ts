import { z } from "zod";

/** Schémas de validation — config métier (services, périodes, créneaux). */

const TIME = /^\d{2}:\d{2}$/;
export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

// ── Services ──
export const serviceCreateSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
});

// ── Périodes ──
export const periodSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
  etiquette: z.string().trim().max(32).optional().nullable(),
  serviceId: z.string().trim().optional().nullable(),
  exerciceId: z.coerce.number().int().positive().optional().nullable(),
  dateStart: z.coerce.date().optional().nullable(),
  dateEnd: z.coerce.date().optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide")
    .default("#6dceaa"),
  position: z.coerce.number().int().min(0).default(0),
  state: z.enum(["actif", "desactive", "archive"]).default("actif"),
});
export type PeriodInput = z.infer<typeof periodSchema>;

/** Identifiant texte (services/slots). */
export const stringIdSchema = z.string().trim().min(1).max(64);
