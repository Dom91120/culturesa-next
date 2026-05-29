import { z } from "zod";

/** Validation de la création d'une réservation (côté usager). */
export const bookingCreateSchema = z.object({
  slotId: z.string().trim().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
  themeLabel: z.string().trim().max(255).default(""),
});
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
