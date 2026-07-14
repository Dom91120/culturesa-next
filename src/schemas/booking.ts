import { z } from "zod";

/**
 * Une réservation doit compter AU MOINS 1 enfant ET AU MOINS 1 accompagnant (décision
 * produit 2026-07-14, suite à l'audit BDD ayant trouvé 2 réservations orphelines
 * enfants=0 ET accompagnants=0 — chaque champ est requis individuellement, pas
 * seulement leur somme). Partagé par tous les points de création (admin ET usager) —
 * cf. schemas/slot.ts pour le même patron (refine + message).
 */
export const hasBothParticipants = (v: { enfants: number; accompagnants: number }) =>
  v.enfants >= 1 && v.accompagnants >= 1;
export const hasBothParticipantsMsg = {
  message: "Au moins 1 enfant et 1 accompagnant sont requis.",
  path: ["enfants"] as (string | number)[],
};

/** Validation de la création d'une réservation (côté usager). */
export const bookingCreateSchema = z
  .object({
    slotId: z.string().trim().min(1),
    enfants: z.coerce.number().int().min(0).max(999).default(0),
    accompagnants: z.coerce.number().int().min(0).max(999).default(0),
    themeLabel: z.string().trim().max(255).default(""),
  })
  .refine(hasBothParticipants, hasBothParticipantsMsg);
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
