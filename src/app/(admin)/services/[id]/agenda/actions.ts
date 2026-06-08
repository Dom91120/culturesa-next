"use server";

import { wrapEmailHtml } from "@/lib/email-theme";
import { prisma } from "@/server/db";
import { requireRole } from "@/server/guards";
import { sendMailOrQueue } from "@/server/mailer";
import { resolvePeriodLabel, sendBookingConfirmationMail } from "@/server/services/booking-mail";
import { isMailEnabled } from "@/server/services/mail-prefs";
import {
  getMailTemplate,
  htmlToText,
  renderHtmlTemplate,
  renderSubjectTemplate,
} from "@/server/services/mail-templates";
import {
  addRecurringSlot,
  addUniqueSlot,
  copyRecurringWeek,
  deleteSlots,
  moveRecurringSlot,
  moveUniqueSlot,
} from "@/server/services/slots";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const DAY_KEYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
type DayKeyT = (typeof DAY_KEYS)[number];

const idSchema = z.coerce.number().int().positive();

export async function setBookingValidatedAction(
  bookingId: number,
  serviceId: string,
  validated: boolean,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { validated } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

export async function setBookingPointageAction(
  bookingId: number,
  serviceId: string,
  pointage: "present" | "absent" | null,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({ where: { id: id.data }, data: { pointage } });
  revalidatePath(`/services/${serviceId}/agenda`);
}

/**
 * Mode création (agenda) : enregistre la CONFIGURATION d'un créneau — sa capacité et
 * la liste des demandeurs autorisés (vide = ouvert à tous). Remplace l'ensemble des
 * SlotDemandeur du créneau. Fonctionne pour les créneaux récurrents comme ponctuels.
 */
export async function saveSlotConfigAction(input: {
  serviceId: string;
  slotId: string;
  capacity: number;
  demandeurIds: number[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const { serviceId, slotId, capacity, demandeurIds } = input;
  if (!Number.isInteger(capacity) || capacity < 0) {
    return { ok: false, error: "Capacité invalide." };
  }
  const ids = [...new Set(demandeurIds.filter((d) => Number.isInteger(d) && d > 0))];
  try {
    await prisma.$transaction(async (tx) => {
      const slot = await tx.slot.findFirst({ where: { id: slotId, serviceId } });
      if (!slot) throw new Error("Créneau introuvable");
      await tx.slot.update({ where: { id: slotId }, data: { capacity } });
      await tx.slotDemandeur.deleteMany({ where: { slotId } });
      if (ids.length > 0) {
        await tx.slotDemandeur.createMany({
          data: ids.map((demandeurId) => ({ slotId, demandeurId })),
        });
      }
    });
  } catch {
    return { ok: false, error: "Échec de l'enregistrement." };
  }
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
}

/**
 * Mode création (agenda, A/B) : copie les créneaux récurrents d'une semaine vers
 * l'autre (même période). Non destructif (cf. copyRecurringWeek).
 */
export async function copyWeekSlotsAction(input: {
  serviceId: string;
  periodId: number;
  fromWeek: "A" | "B";
  toWeek: "A" | "B";
}): Promise<{ ok: boolean; error?: string; created?: number }> {
  await requireRole("gestionnaire");
  const res = await copyRecurringWeek(
    input.serviceId,
    input.periodId,
    input.fromWeek,
    input.toWeek,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true, created: res.created } : { ok: false, error: res.error };
}

// ─── Mode « Création de créneau » (agenda) ───────────────────────────────────

/**
 * Mode création (agenda) : met à jour la CAPACITÉ PAR DÉFAUT du service (`capacity`).
 * Autosave du champ « Capacité ».
 */
export async function setServiceDefaultCapacityAction(input: {
  serviceId: string;
  value: number;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const value = Math.max(1, Math.floor(input.value));
  if (!Number.isFinite(value)) return { ok: false, error: "Capacité invalide." };
  await prisma.service.update({
    where: { id: input.serviceId },
    data: { capacity: value },
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}

/** Pose la liste de demandeurs autorisés sur un créneau (vide = ouvert à tous). */
async function setSlotDemandeurs(slotId: string, demandeurIds: number[] | undefined) {
  const ids = [...new Set((demandeurIds ?? []).filter((d) => Number.isInteger(d) && d > 0))];
  if (ids.length === 0) return;
  await prisma.slotDemandeur.createMany({
    data: ids.map((demandeurId) => ({ slotId, demandeurId })),
  });
}

/** Crée un créneau récurrent (vue Modèle de période). */
export async function createRecurringSlotAction(input: {
  serviceId: string;
  periodId: number;
  dayKey: string;
  startTime: string;
  endTime: string;
  weeks: string;
  capacity: number;
  demandeurIds?: number[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  if (!(DAY_KEYS as readonly string[]).includes(input.dayKey)) {
    return { ok: false, error: "Jour invalide." };
  }
  const res = await addRecurringSlot(input.serviceId, input.periodId, {
    startTime: input.startTime,
    endTime: input.endTime,
    weeks: input.weeks,
    dayKey: input.dayKey as DayKeyT,
    capacity: input.capacity,
  });
  if (res.ok) await setSlotDemandeurs(res.id, input.demandeurIds);
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Crée un créneau ponctuel daté (vue Semaine réelle). */
export async function createUniqueSlotAction(input: {
  serviceId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  demandeurIds?: number[];
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await addUniqueSlot(input.serviceId, {
    slotDate: input.slotDate,
    startTime: input.startTime,
    endTime: input.endTime,
    capacity: input.capacity,
  });
  if (res.ok) await setSlotDemandeurs(res.id, input.demandeurIds);
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Déplace un créneau récurrent vide (jour + horaires) depuis l'agenda. */
export async function moveRecurringSlotAction(input: {
  serviceId: string;
  slotId: string;
  fromDayKey: string;
  toDayKey: string;
  startTime: string;
  endTime: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  if (
    !(DAY_KEYS as readonly string[]).includes(input.fromDayKey) ||
    !(DAY_KEYS as readonly string[]).includes(input.toDayKey)
  ) {
    return { ok: false, error: "Jour invalide." };
  }
  const res = await moveRecurringSlot(
    input.serviceId,
    input.slotId,
    input.fromDayKey as DayKeyT,
    input.toDayKey as DayKeyT,
    input.startTime,
    input.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Déplace un créneau ponctuel vide (date + horaires) depuis l'agenda. */
export async function moveUniqueSlotAction(input: {
  serviceId: string;
  slotId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await moveUniqueSlot(
    input.serviceId,
    input.slotId,
    input.slotDate,
    input.startTime,
    input.endTime,
  );
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Supprime un créneau (et ses miroirs/réservations) depuis l'agenda. */
export async function deleteSlotAction(
  serviceId: string,
  slotId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await deleteSlots(serviceId, [slotId]);
  revalidatePath(`/services/${serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

const DAY_LABELS: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

/** Libellé « créneau » lisible pour le mail : date+heure (ponctuel) ou jour+heure (récurrent). */
function slotMailLabel(slot: {
  startTime: string;
  endTime: string;
  slotDate: Date | null;
  slotDay: string | null;
}): string {
  const s = (slot.startTime || "").slice(0, 5);
  const e = (slot.endTime || "").slice(0, 5);
  const time = s && e ? `${s} – ${e}` : "Journée entière";
  if (slot.slotDate) {
    // slotDate stocké à minuit UTC → on formate en UTC pour éviter tout décalage de jour.
    const d = slot.slotDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${d} · ${time}`;
  }
  const day = slot.slotDay ? (DAY_LABELS[slot.slotDay] ?? slot.slotDay) : "";
  return [day, time].filter(Boolean).join(" · ");
}

/**
 * Supprime une réservation depuis l'agenda + notifie l'usager par e-mail.
 * Le mail informe que la réservation « a été supprimée » (si elle était validée) ou
 * « n'a pas été validée » (sinon) ; le `motif` saisi par le gestionnaire y est ajouté.
 * L'envoi est best-effort : un échec d'e-mail ne fait pas échouer la suppression.
 */
export async function deleteBookingAdminAction(
  bookingId: number,
  serviceId: string,
  motif?: string,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  // Infos nécessaires au mail, lues AVANT la suppression.
  const booking = await prisma.booking.findUnique({
    where: { id: id.data },
    select: {
      validated: true,
      periodId: true,
      user: { select: { email: true, prenom: true } },
      service: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  await prisma.booking.delete({ where: { id: id.data } });
  revalidatePath(`/services/${serviceId}/agenda`);

  // Notification usager (best-effort) : n'interrompt pas le flux en cas d'échec.
  const email = booking?.user?.email?.trim();
  if (booking && email?.includes("@")) {
    const wasValidated = booking.validated;
    // Préférence « Échanges » : ce type d'e-mail est-il activé ?
    if (!(await isMailEnabled(wasValidated ? "booking_cancelled" : "booking_refused"))) return;
    const serviceLabel = booking.service?.label ?? "";
    const slotLabel = booking.slot ? slotMailLabel(booking.slot) : "";
    // Période : par id (récurrent) ou par date couverte (ponctuel).
    const periodLabel = await resolvePeriodLabel({
      serviceId,
      periodId: booking.periodId,
      slotDate: booking.slot?.slotDate ?? null,
    });
    const prenom = booking.user?.prenom?.trim() ?? "";
    const vars: Record<string, string> = {
      salutation: prenom ? `Bonjour ${prenom},` : "Bonjour,",
      prenom,
      service: serviceLabel,
      creneau: slotLabel,
      periode: periodLabel,
      motif: (motif ?? "").trim().slice(0, 1000),
    };
    const tpl = await getMailTemplate(wasValidated ? "booking_cancelled" : "booking_refused");
    const inner = renderHtmlTemplate(tpl.html, vars);
    const subject = renderSubjectTemplate(tpl.subject, vars);
    // Best-effort : en cas d'échec, l'e-mail est mis en file (renvoyable depuis
    // Administration > Messagerie). N'interrompt jamais la suppression.
    await sendMailOrQueue({
      to: email,
      subject,
      html: wrapEmailHtml(inner, { preheader: subject }),
      text: htmlToText(inner),
    });
  }
}

const detailSchema = z.object({
  bookingId: z.coerce.number().int().positive(),
  serviceId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(99),
  accompagnants: z.coerce.number().int().min(0).max(99),
  theme: z.string().trim().max(255),
});

/**
 * Met à jour les détails d'une réservation depuis la modale « 📋 Réservation » :
 * compteurs enfants/accompagnants + thème (UNE seule action, équivalent legacy
 * `update_counts` + `update_theme`). Refuse si la réservation est pointée.
 */
export async function updateBookingDetailAction(input: {
  bookingId: number;
  serviceId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  const current = await prisma.booking.findUnique({
    where: { id: d.bookingId },
    select: { pointage: true },
  });
  if (!current) return { ok: false, error: "Réservation introuvable." };
  if (current.pointage != null) {
    return { ok: false, error: "Réservation pointée, non modifiable." };
  }
  await prisma.booking.update({
    where: { id: d.bookingId },
    data: { enfants: d.enfants, accompagnants: d.accompagnants, themeLabel: d.theme },
  });
  revalidatePath(`/services/${d.serviceId}/agenda`);
  return { ok: true };
}

/** Déplace une réservation vers un autre créneau (glisser-déposer). Le jour est porté
 * par le créneau cible (slotDay) : changer de jour = changer de slotId. */
export async function moveBookingAction(
  bookingId: number,
  serviceId: string,
  _dayKey: string,
  slotId: string,
) {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return;
  await prisma.booking.update({
    where: { id: id.data },
    // auto_validate_from réinitialisé à NOW() sur un déplacement (cf. logique d'origine).
    data: { slotId, autoValidateFrom: new Date() },
  });
  revalidatePath(`/services/${serviceId}/agenda`);
}

const createSchema = z.object({
  serviceId: z.string().min(1),
  slotId: z.string().min(1),
  periodId: z.coerce.number().int().positive(),
  dayKey: z.string().min(1),
  userId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
  theme: z.string().trim().max(255).default(""),
  week: z.enum(["", "A", "B"]).default(""),
});

/** Crée une réservation récurrente (clic sur un créneau vide de l'agenda). */
export async function createRecurringBookingAction(input: {
  serviceId: string;
  slotId: string;
  periodId: number;
  dayKey: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  week: "" | "A" | "B";
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  try {
    await prisma.booking.create({
      data: {
        bookingType: "recurring",
        userId: d.userId,
        serviceId: d.serviceId,
        slotId: d.slotId,
        periodId: d.periodId,
        week: d.week,
        enfants: d.enfants,
        accompagnants: d.accompagnants,
        themeLabel: d.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  // Confirmation à l'usager (best-effort) : réservation créée par un gestionnaire = validée.
  const slot = await prisma.slot.findUnique({
    where: { id: d.slotId },
    select: {
      startTime: true,
      endTime: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (slot) {
    await sendBookingConfirmationMail({
      userId: d.userId,
      serviceId: d.serviceId,
      serviceLabel: slot.service.label,
      validated: true,
      slot: {
        startTime: slot.startTime,
        endTime: slot.endTime,
        slotDate: null,
        slotDay: slot.slotDay,
      },
      periodId: d.periodId,
      enfants: d.enfants,
      accompagnants: d.accompagnants,
      theme: d.theme,
    });
  }
  return { ok: true };
}

const createUniqueSchema = z.object({
  serviceId: z.string().min(1),
  slotId: z.string().min(1),
  userId: z.string().min(1),
  enfants: z.coerce.number().int().min(0).max(999).default(0),
  accompagnants: z.coerce.number().int().min(0).max(999).default(0),
  theme: z.string().trim().max(255).default(""),
});

/**
 * Crée une réservation PONCTUELLE (clic sur un créneau ponctuel de l'agenda).
 * Insert direct validé côté admin : pas de contrôle « créneau passé » ni de jauge
 * (le gestionnaire peut réserver n'importe quel créneau), à l'image de
 * `createRecurringBookingAction`. Un ponctuel n'a ni période ni jour : periodId=0,
 * dayKey="" et week="" (cf. modèle Booking / createUniqueBooking).
 */
export async function createUniqueBookingAction(input: {
  serviceId: string;
  slotId: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const parsed = createUniqueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  const slot = await prisma.slot.findUnique({
    where: { id: d.slotId },
    select: {
      slotType: true,
      serviceId: true,
      startTime: true,
      endTime: true,
      slotDate: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (!slot || slot.slotType !== "unique" || slot.serviceId !== d.serviceId) {
    return { ok: false, error: "Créneau introuvable." };
  }
  try {
    await prisma.booking.create({
      data: {
        bookingType: "unique",
        userId: d.userId,
        serviceId: d.serviceId,
        slotId: d.slotId,
        periodId: 0,
        week: "",
        enfants: d.enfants,
        accompagnants: d.accompagnants,
        themeLabel: d.theme,
        validated: true,
        autoValidateFrom: new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    throw e;
  }
  revalidatePath(`/services/${d.serviceId}/agenda`);
  // Confirmation à l'usager (best-effort) : réservation créée par un gestionnaire = validée.
  await sendBookingConfirmationMail({
    userId: d.userId,
    serviceId: d.serviceId,
    serviceLabel: slot.service.label,
    validated: true,
    slot: {
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotDate: slot.slotDate,
      slotDay: slot.slotDay,
    },
    enfants: d.enfants,
    accompagnants: d.accompagnants,
    theme: d.theme,
  });
  return { ok: true };
}

const copyTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recurring"),
    periodId: z.coerce.number().int().positive(),
    dayKey: z.string().min(1),
    slotId: z.string().min(1),
    week: z.enum(["", "A", "B"]).default(""),
  }),
  z.object({
    kind: z.literal("unique"),
    slotId: z.string().min(1),
  }),
]);

/**
 * Copie une réservation existante vers un autre créneau : lit l'usager + les
 * compteurs + le thème de la source, puis recrée une réservation sur la cible
 * (récurrente ou ponctuelle) via les actions de création. La source est conservée
 * (copier, pas couper). Le contrôle d'unicité (P2002) renvoie une erreur lisible.
 */
export async function copyBookingAction(input: {
  serviceId: string;
  sourceBookingId: number;
  target:
    | { kind: "recurring"; periodId: number; dayKey: string; slotId: string; week: "" | "A" | "B" }
    | { kind: "unique"; slotId: string };
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const id = idSchema.safeParse(input.sourceBookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  const target = copyTargetSchema.safeParse(input.target);
  if (!target.success) return { ok: false, error: "Cible invalide." };
  const src = await prisma.booking.findUnique({
    where: { id: id.data },
    select: {
      userId: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      serviceId: true,
    },
  });
  if (!src || src.serviceId !== input.serviceId) {
    return { ok: false, error: "Réservation introuvable." };
  }
  if (target.data.kind === "recurring") {
    return createRecurringBookingAction({
      serviceId: input.serviceId,
      slotId: target.data.slotId,
      periodId: target.data.periodId,
      dayKey: target.data.dayKey,
      userId: src.userId,
      enfants: src.enfants,
      accompagnants: src.accompagnants,
      theme: src.themeLabel ?? "",
      week: target.data.week,
    });
  }
  return createUniqueBookingAction({
    serviceId: input.serviceId,
    slotId: target.data.slotId,
    userId: src.userId,
    enfants: src.enfants,
    accompagnants: src.accompagnants,
    theme: src.themeLabel ?? "",
  });
}

/**
 * Coupe une réservation vers un autre créneau : recrée la réservation sur la cible
 * (comme copier), puis supprime la source si la création a réussi. Si la création
 * échoue (ex. doublon), la source est conservée et l'erreur est renvoyée.
 */
export async function cutBookingAction(input: {
  serviceId: string;
  sourceBookingId: number;
  target:
    | { kind: "recurring"; periodId: number; dayKey: string; slotId: string; week: "" | "A" | "B" }
    | { kind: "unique"; slotId: string };
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("gestionnaire");
  const res = await copyBookingAction(input);
  if (!res.ok) return res;
  const id = idSchema.safeParse(input.sourceBookingId);
  if (id.success) {
    await prisma.booking.delete({ where: { id: id.data } }).catch(() => {});
  }
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}
