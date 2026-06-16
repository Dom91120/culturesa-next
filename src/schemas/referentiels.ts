import { z } from "zod";

/** Schémas de validation des référentiels (partagés serveur ↔ client). */

export const structureSchema = z.object({
  demandeurId: z.coerce.number().int().positive("Demandeur invalide"),
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(150),
});
export type StructureInput = z.infer<typeof structureSchema>;

export const niveauSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(50),
  demandeurId: z.coerce.number().int().positive().optional().nullable(),
  position: z.coerce.number().int().min(0).default(0),
});
export type NiveauInput = z.infer<typeof niveauSchema>;
