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

/**
 * Compteurs d'une réservation : bornes UNIQUES 0-999, partagées par la création ET
 * l'édition, admin ET usager (avant l'audit 2026-07-17 : 6 déclarations, l'édition
 * plafonnait à 99 et le panier `updates` ne bornait rien). La limite réelle reste la
 * jauge/capacité du créneau (assertSlotCapacity).
 */
export const bookingEnfantsSchema = z.coerce.number().int().min(0).max(999);
export const bookingAccompagnantsSchema = z.coerce.number().int().min(0).max(999);
/** Thème d'une réservation (colonne themeLabel, 255). */
export const bookingThemeSchema = z.string().trim().max(255);

/** Édition des compteurs + thème d'une réservation existante (admin ET usager). */
export const bookingDetailSchema = z
  .object({
    enfants: bookingEnfantsSchema,
    accompagnants: bookingAccompagnantsSchema,
    theme: bookingThemeSchema.default(""),
  })
  .refine(hasBothParticipants, hasBothParticipantsMsg);

/** Validation de la création d'une réservation (côté usager). */
export const bookingCreateSchema = z
  .object({
    slotId: z.string().trim().min(1),
    enfants: bookingEnfantsSchema.default(0),
    accompagnants: bookingAccompagnantsSchema.default(0),
    themeLabel: bookingThemeSchema.default(""),
  })
  .refine(hasBothParticipants, hasBothParticipantsMsg);
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;

/**
 * Refus « thème obligatoire » (réglage service × demandeur). Message UNIQUE : le
 * formulaire l'affiche en toast avant l'envoi, le serveur le renvoie s'il est atteint
 * malgré tout — deux formulations divergentes se remarqueraient tôt ou tard.
 */
export const THEME_REQUIS_MSG = "Veuillez renseigner le thème";
