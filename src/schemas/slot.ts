import { z } from "zod";
import { DAYS } from "./config";

/**
 * Validation de la CRÉATION de créneaux depuis l'agenda (mode « Création de créneau »).
 * Frontière de confiance : les server actions reçoivent des entrées non fiables, le
 * typage TS ne protège pas. On borne ici horaires, capacité et identifiants AVANT toute
 * écriture (cf. addRecurringSlot / addUniqueSlot).
 */

// Heure « HH:MM » 24 h, zéro-paddée → la comparaison lexicographique start < end est sûre.
// Le VIDE ("") est accepté : un créneau « journée entière » est stocké sans horaires
// (startTime/endTime vides), représentation lue par la grille (allday = !start || !end).
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (label: string) =>
  z.string().refine((v) => v === "" || TIME.test(v), `${label} invalide (format HH:MM).`);

// Capacité d'un créneau : entier ≥ 1 (un créneau à 0 place n'a pas de sens à la création).
const capacity = z.coerce
  .number()
  .int("Capacité invalide.")
  .min(1, "La capacité doit être au moins de 1.")
  .max(9999, "Capacité trop élevée.");

// Demandeurs autorisés : entiers > 0 (vide/absent = ouvert à tous). normalizeDemandeurIds
// dédoublonne ensuite côté service.
const demandeurIds = z.array(z.coerce.number().int().positive()).optional();

// « A une jauge » : mode jauge de l'agenda au moment de la création (off par défaut).
const jauge = z.boolean().optional().default(false);

// Journée entière (deux heures vides) → pas de contrôle d'ordre ; sinon les deux heures
// doivent être renseignées ET ordonnées (start < end).
const hoursOrdered = (v: { startTime: string; endTime: string }) =>
  (!v.startTime && !v.endTime) || (!!v.startTime && !!v.endTime && v.startTime < v.endTime);
const hoursOrderedMsg = {
  message: "L'heure de fin doit être postérieure à l'heure de début.",
  path: ["endTime"] as (string | number)[],
};

export const recurringSlotCreateSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    periodId: z.coerce.number().int().positive(),
    dayKey: z.enum(DAYS),
    // weeks : "", "A" ou "B" (normalizeWeeks ramène toute autre valeur à "" = toutes
    // semaines). On reste permissif ici ; la règle A/B stricte est appliquée par abWeekError.
    weeks: z.string().max(8).default(""),
    startTime: time("Heure de début"),
    endTime: time("Heure de fin"),
    capacity,
    demandeurIds,
    jauge,
  })
  .refine(hoursOrdered, hoursOrderedMsg);

export const uniqueSlotCreateSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (format AAAA-MM-JJ)."),
    startTime: time("Heure de début"),
    endTime: time("Heure de fin"),
    capacity,
    demandeurIds,
    jauge,
  })
  .refine(hoursOrdered, hoursOrderedMsg);

export type RecurringSlotCreateInput = z.infer<typeof recurringSlotCreateSchema>;
export type UniqueSlotCreateInput = z.infer<typeof uniqueSlotCreateSchema>;
