import { z } from "zod";

/** Schémas de validation — config métier (services, périodes, créneaux). */

const TIME = /^\d{2}:\d{2}$/;
export const DAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
const dayEnum = z.enum(DAYS);

// ── Services ──
export const serviceCreateSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
});

export const serviceUpdateSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire").max(128),
  position: z.coerce.number().int().min(0).default(0),
  maxReservations: z.coerce.number().int().min(1).default(1),
  maxReservationsPeriod: z.coerce.number().int().min(1).default(1),
  // tableau de jours coché -> stocké en "lun,mar,..."
  activeDays: z
    .array(dayEnum)
    .default([])
    .transform((d) => d.join(",")),
  duration: z.coerce.number().int().min(1).default(60),
  capacity: z.coerce.number().int().min(1).default(1),
  morningStart: z.string().regex(TIME, "Heure invalide"),
  morningEnd: z.string().regex(TIME, "Heure invalide"),
  afternoonStart: z.string().regex(TIME, "Heure invalide"),
  afternoonEnd: z.string().regex(TIME, "Heure invalide"),
  icon: z.string().trim().max(16).optional().nullable(),
  bookingDelay: z.coerce.number().int().min(0).default(0),
  openOnHolidays: z.boolean().default(false),
  showPreviousExercices: z.boolean().default(false),
  semaineAb: z.boolean().default(false),
  themesMode: z.enum(["libre", "liste"]).default("libre"),
  autoValidationDelay: z.coerce.number().int().default(0),
});
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;

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

// ── Créneaux (slots) ──
export const slotSchema = z
  .object({
    serviceId: z.string().trim().min(1),
    slotType: z.enum(["recurring", "unique"]).default("recurring"),
    startTime: z.string().regex(TIME, "Heure invalide"),
    endTime: z.string().regex(TIME, "Heure invalide"),
    slotDate: z.coerce.date().optional().nullable(),
    // Jour de la semaine pour un créneau récurrent (un slot = un jour).
    slotDay: dayEnum.optional().nullable(),
    capacity: z.coerce.number().int().min(0).optional().nullable(),
    periodId: z.coerce.number().int().positive().optional().nullable(),
    state: z.enum(["actif", "desactive", "archive"]).default("actif"),
  })
  .refine((s) => s.slotType !== "unique" || s.slotDate != null, {
    message: "Une date est requise pour un créneau ponctuel",
    path: ["slotDate"],
  })
  .refine((s) => s.slotType !== "recurring" || s.slotDay != null, {
    message: "Un jour est requis pour un créneau récurrent",
    path: ["slotDay"],
  });
export type SlotInput = z.infer<typeof slotSchema>;

/** Identifiant texte (services/slots). */
export const stringIdSchema = z.string().trim().min(1).max(64);
