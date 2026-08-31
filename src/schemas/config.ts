import { z } from "zod";

/** Schémas de validation — config métier (services, périodes, créneaux). */

export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;

// ── Services ──
export const serviceCreateSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
  // E-mail générique de contact, facultatif ("" accepté → null côté action).
  contactEmail: z.email("Adresse e-mail de contact invalide").max(254).or(z.literal("")),
});

/** Identifiant texte (services/slots). */
export const stringIdSchema = z.string().trim().min(1).max(64);
