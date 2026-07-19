import { z } from "zod";
import { DAYS, stringIdSchema } from "./config";

/**
 * Validation de la CRÉATION de créneaux depuis l'agenda (mode « Création de créneau »).
 * Frontière de confiance : les server actions reçoivent des entrées non fiables, le
 * typage TS ne protège pas. On borne ici horaires, capacité et identifiants AVANT toute
 * écriture (cf. addRecurringSlot / addUniqueSlot).
 */

// Heure « HH:MM » 24 h, zéro-paddée → la comparaison lexicographique start < end est sûre.
// Regex STRICTE (00–23 h, 00–59 min), source unique partagée avec la validation des
// plages d'ouverture d'exercice (periodes/actions.ts) — évite qu'une heure hors 24 h
// (« 27:61 ») soit acceptée d'un côté et rejetée de l'autre.
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Date « AAAA-MM-JJ » : source unique (même patron que TIME_RE) — la regex était
// redéclarée dans 6 fichiers avant l'audit 2026-07-17.
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Le VIDE ("") est accepté ICI : un créneau « journée entière » est stocké sans horaires
// (startTime/endTime vides), représentation lue par la grille (allday = !start || !end).
const time = (label: string) =>
  z.string().refine((v) => v === "" || TIME_RE.test(v), `${label} invalide (format HH:MM).`);

// Capacité (source unique) : entier borné, partagé par la création de créneau, la
// reconfiguration et la capacité par défaut du service (evite un plafond oublie).
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 9999;
const capacity = z.coerce
  .number()
  .int("Capacité invalide.")
  .min(MIN_CAPACITY, "La capacité doit être au moins de 1.")
  .max(MAX_CAPACITY, "Capacité trop élevée.");

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
    serviceId: stringIdSchema,
    periodId: z.coerce.number().int().positive(),
    dayKey: z.enum(DAYS),
    // weeks : "", "A" ou "B" (normalizeWeeks ramène toute autre valeur à "" = toutes les
    // semaines). "" est valide même en mode A/B (créneau récurrent sur toutes les semaines).
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
    serviceId: stringIdSchema,
    slotDate: z.string().regex(DATE_RE, "Date invalide (format AAAA-MM-JJ)."),
    startTime: time("Heure de début"),
    endTime: time("Heure de fin"),
    capacity,
    demandeurIds,
    jauge,
    // Lot « multi » : identifiant partagé par les créneaux d'un même geste de création
    // répliquée (null/absent = ponctuel isolé).
    batchId: z.string().min(1).max(64).nullish(),
    // Portée de parité du LOT « multi » (semaines sur lesquelles la série a été répliquée) :
    // "A" | "B" | "" (toutes). normalizeWeeks ramène toute autre valeur à "". Vide pour un
    // ponctuel isolé. Même sens que Slot.weeks des récurrents (portée de parité).
    weeks: z.string().max(8).optional(),
  })
  .refine(hoursOrdered, hoursOrderedMsg);
