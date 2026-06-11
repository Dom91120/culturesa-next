"use server";

import { todayParisISO } from "@/lib/booking-delay";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";
import { requireServiceManager } from "@/server/guards";
import {
  formatSlotLabel,
  resolvePeriodLabel,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import { BookingError, assertSlotCapacity } from "@/server/services/bookings";
import { isMailEnabled } from "@/server/services/mail-prefs";
import { sendTemplatedMail } from "@/server/services/mail-send";
import { syncRecurringChildren } from "@/server/services/recurring-children";
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

// Jours : source unique = DAYS (schemas/config). type DayKeyT en dérive (audit D2).
type DayKeyT = (typeof DAYS)[number];

const idSchema = z.coerce.number().int().positive();

/** Un parent récurrent a-t-il au moins un miroir (enfant) POINTÉ ? → il devient immuable. */
async function parentLockedByPointage(parentId: number): Promise<boolean> {
  return (
    (await prisma.booking.count({
      where: { parentBookingId: parentId, pointage: { not: null } },
    })) > 0
  );
}

/**
 * Une réservation est-elle verrouillée pour toute action de gestion (supprimer,
 * modifier, déplacer, copier, valider) ? Règles :
 *   - un MIROIR (enfant, parentBookingId non null) est toujours immuable ;
 *   - une réservation autonome POINTÉE est verrouillée ;
 *   - un PARENT récurrent dont un miroir est pointé est verrouillé.
 * Seul le pointage d'un miroir échappe à ce verrou (géré à part).
 */
async function bookingLocked(b: {
  id: number;
  bookingType: string;
  parentBookingId: number | null;
  pointage: string | null;
}): Promise<boolean> {
  if (b.parentBookingId != null) return true; // miroir : immuable
  if (b.pointage != null) return true; // réservation pointée
  if (b.bookingType === "recurring" && (await parentLockedByPointage(b.id))) return true;
  return false;
}

export async function setBookingValidatedAction(
  bookingId: number,
  serviceId: string,
  validated: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const b = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      id: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      validated: true,
      userId: true,
      periodId: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      service: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  if (!b) return { ok: false, error: "Réservation introuvable." };
  // Miroir non validable ; parent/​autonome verrouillé par un pointage non plus.
  if (await bookingLocked(b)) {
    return { ok: false, error: "Réservation verrouillée (séance pointée ou miroir)." };
  }
  const changed = b.validated !== validated;
  // Validation au niveau de la SÉRIE : le parent + propagation à tous ses miroirs.
  await prisma.$transaction([
    prisma.booking.update({ where: { id: id.data }, data: { validated } }),
    prisma.booking.updateMany({ where: { parentBookingId: id.data }, data: { validated } }),
  ]);
  revalidatePath(`/services/${serviceId}/agenda`);

  // Notifie l'usager d'une (dé)validation MANUELLE par le gestionnaire (best-effort,
  // uniquement sur transition réelle) : e-mail « validée » ou « en attente » (port legacy).
  if (changed && b.slot) {
    await sendBookingConfirmationMail({
      userId: b.userId,
      serviceId,
      serviceLabel: b.service?.label ?? "",
      validated,
      slot: b.slot,
      periodId: b.periodId,
      enfants: b.enfants,
      accompagnants: b.accompagnants,
      theme: b.themeLabel ?? "",
    });
  }
  return { ok: true };
}

export async function setBookingPointageAction(
  bookingId: number,
  serviceId: string,
  pointage: "present" | "absent" | null,
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Les parents (récurrents) NE sont PAS pointables : seuls les miroirs (et les
  // ponctuelles autonomes) le sont.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const b = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: { bookingType: true },
  });
  if (!b) return { ok: false, error: "Réservation introuvable." };
  if (b.bookingType === "recurring") {
    return { ok: false, error: "Une récurrente se pointe sur ses séances datées." };
  }
  await prisma.booking.update({ where: { id: id.data }, data: { pointage } });
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
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
  await requireServiceManager(input.serviceId);
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
  await requireServiceManager(input.serviceId);
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
  await requireServiceManager(input.serviceId);
  const value = Math.max(1, Math.floor(input.value));
  if (!Number.isFinite(value)) return { ok: false, error: "Capacité invalide." };
  await prisma.service.update({
    where: { id: input.serviceId },
    data: { capacity: value },
  });
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}

/**
 * Liste des usagers proposés dans la modale de création de réservation. Chargée À LA
 * DEMANDE (ouverture de la modale) : auparavant TOUS les comptes étaient chargés par
 * la page agenda et re-fetchés à chaque tick d'auto-rafraîchissement (audit perf).
 */
export async function listAgendaUsersAction(serviceId: string): Promise<
  {
    id: string;
    label: string;
    demandeur: string;
    structure: string;
    openOnSchoolHolidays: boolean;
  }[]
> {
  await requireServiceManager(serviceId);
  const users = await prisma.user.findMany({
    where: { role: "utilisateur" },
    orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    select: {
      id: true,
      nom: true,
      prenom: true,
      demandeur: { select: { label: true, openOnSchoolHolidays: true } },
      structure: { select: { label: true } },
    },
  });
  return users.map((u) => ({
    id: u.id,
    label: `${u.nom} ${u.prenom}`.trim() + (u.demandeur ? ` — ${u.demandeur.label}` : ""),
    demandeur: u.demandeur?.label ?? "",
    structure: u.structure?.label ?? "",
    // Politique vacances scolaires du demandeur (false = fermé → occurrences exclues).
    openOnSchoolHolidays: u.demandeur?.openOnSchoolHolidays ?? true,
  }));
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
  await requireServiceManager(input.serviceId);
  if (!(DAYS as readonly string[]).includes(input.dayKey)) {
    return { ok: false, error: "Jour invalide." };
  }
  const res = await addRecurringSlot(input.serviceId, input.periodId, {
    startTime: input.startTime,
    endTime: input.endTime,
    weeks: input.weeks,
    dayKey: input.dayKey as DayKeyT,
    capacity: input.capacity,
    demandeurIds: input.demandeurIds,
  });
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
  await requireServiceManager(input.serviceId);
  const res = await addUniqueSlot(input.serviceId, {
    slotDate: input.slotDate,
    startTime: input.startTime,
    endTime: input.endTime,
    capacity: input.capacity,
    demandeurIds: input.demandeurIds,
  });
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
  await requireServiceManager(input.serviceId);
  if (
    !(DAYS as readonly string[]).includes(input.fromDayKey) ||
    !(DAYS as readonly string[]).includes(input.toDayKey)
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
  await requireServiceManager(input.serviceId);
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
  await requireServiceManager(serviceId);
  const res = await deleteSlots(serviceId, [slotId]);
  revalidatePath(`/services/${serviceId}/agenda`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
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
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Infos nécessaires au mail + verrou, lues AVANT la suppression.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const booking = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      validated: true,
      periodId: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      user: { select: { email: true, prenom: true } },
      service: { select: { label: true } },
      slot: { select: { startTime: true, endTime: true, slotDate: true, slotDay: true } },
    },
  });
  if (!booking) return { ok: false, error: "Réservation introuvable." };
  // Miroir immuable, ou réservation/​parent verrouillé par un pointage → pas de suppression.
  if (
    await bookingLocked({
      id: id.data,
      bookingType: booking.bookingType,
      parentBookingId: booking.parentBookingId,
      pointage: booking.pointage,
    })
  ) {
    return { ok: false, error: "Réservation verrouillée (séance pointée ou miroir)." };
  }
  await prisma.booking.delete({ where: { id: id.data } });
  revalidatePath(`/services/${serviceId}/agenda`);

  // Notification usager (best-effort) : n'interrompt pas le flux en cas d'échec —
  // la suppression est déjà committée, tous les chemins ci-dessous sont un succès.
  const email = booking?.user?.email?.trim();
  if (booking && email?.includes("@")) {
    const wasValidated = booking.validated;
    // Préférence « Échanges » : ce type d'e-mail est-il activé ?
    if (!(await isMailEnabled(wasValidated ? "booking_cancelled" : "booking_refused"))) {
      return { ok: true };
    }
    const serviceLabel = booking.service?.label ?? "";
    const slotLabel = booking.slot ? formatSlotLabel(booking.slot) : "";
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
    // Best-effort : en cas d'échec, l'e-mail est mis en file (renvoyable depuis
    // Administration > Messagerie). N'interrompt jamais la suppression.
    await sendTemplatedMail({
      to: email,
      kind: wasValidated ? "booking_cancelled" : "booking_refused",
      vars,
    });
  }
  return { ok: true };
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
  await requireServiceManager(input.serviceId);
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const current = await prisma.booking.findFirst({
    where: { id: d.bookingId, serviceId: d.serviceId },
    select: {
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      slotId: true,
      periodId: true,
    },
  });
  if (!current) return { ok: false, error: "Réservation introuvable." };
  if (current.parentBookingId != null) {
    return { ok: false, error: "Une séance (miroir) n'est pas modifiable." };
  }
  if (await bookingLocked({ id: d.bookingId, ...current })) {
    return { ok: false, error: "Réservation pointée, non modifiable." };
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // Anti-surbooking : augmenter les compteurs ne doit pas dépasser la jauge/capacité
        // (la réservation courante est exclue du décompte).
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: current.slotId,
          bookingType: current.bookingType === "recurring" ? "recurring" : "unique",
          periodId: current.periodId,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
          excludeBookingId: d.bookingId,
        });
        await tx.booking.update({
          where: { id: d.bookingId },
          data: { enfants: d.enfants, accompagnants: d.accompagnants, themeLabel: d.theme },
        });
        const b = await tx.booking.findUnique({
          where: { id: d.bookingId },
          select: {
            id: true,
            bookingType: true,
            userId: true,
            serviceId: true,
            slotId: true,
            periodId: true,
            week: true,
            themeLabel: true,
            enfants: true,
            accompagnants: true,
            validated: true,
          },
        });
        // Récurrente : propage counts/thème aux réservations-enfants.
        // Gestionnaire : pas de délai de réservation, on borne juste au présent.
        if (b && b.bookingType === "recurring")
          await syncRecurringChildren(tx, b, { cutoffISO: todayParisISO() });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Modification simultanée détectée, réessayez." };
    }
    throw e;
  }
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
): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(serviceId);
  const id = idSchema.safeParse(bookingId);
  if (!id.success) return { ok: false, error: "Données invalides." };
  // Miroir immuable / réservation verrouillée par un pointage → pas de déplacement.
  // Anti-IDOR : la réservation doit appartenir au service couvert par le guard.
  const lk = await prisma.booking.findFirst({
    where: { id: id.data, serviceId },
    select: {
      id: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      periodId: true,
      enfants: true,
      accompagnants: true,
    },
  });
  if (!lk) return { ok: false, error: "Réservation introuvable." };
  if (await bookingLocked(lk)) return { ok: false, error: "Réservation verrouillée." };
  try {
    await prisma.$transaction(
      async (tx) => {
        // Anti-surbooking : déplacer vers un créneau complet est refusé (jauge/capacité).
        await assertSlotCapacity(tx, {
          serviceId,
          slotId,
          bookingType: lk.bookingType === "recurring" ? "recurring" : "unique",
          periodId: lk.periodId,
          enfants: lk.enfants,
          accompagnants: lk.accompagnants,
          excludeBookingId: id.data,
        });
        await tx.booking.update({
          where: { id: id.data },
          // auto_validate_from réinitialisé à NOW() sur un déplacement (cf. logique d'origine).
          data: { slotId, autoValidateFrom: new Date() },
        });
        const b = await tx.booking.findUnique({
          where: { id: id.data },
          select: {
            id: true,
            bookingType: true,
            userId: true,
            serviceId: true,
            slotId: true,
            periodId: true,
            week: true,
            themeLabel: true,
            enfants: true,
            accompagnants: true,
            validated: true,
          },
        });
        // Récurrente : régénère les enfants sur les miroirs du nouveau créneau.
        // Gestionnaire : pas de délai de réservation, on borne juste au présent.
        if (b && b.bookingType === "recurring")
          await syncRecurringChildren(tx, b, { cutoffISO: todayParisISO() });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Déplacement simultané détecté, réessayez." };
    }
    throw e;
  }
  revalidatePath(`/services/${serviceId}/agenda`);
  return { ok: true };
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
  await requireServiceManager(input.serviceId);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Données invalides." };
  const d = parsed.data;
  try {
    await prisma.$transaction(
      async (tx) => {
        // Anti-surbooking : le gestionnaire ne peut pas dépasser la jauge/capacité.
        // (pas de délai de réservation côté gestionnaire, mais la capacité s'applique.)
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: d.slotId,
          bookingType: "recurring",
          periodId: d.periodId,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
        });
        const created = await tx.booking.create({
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
        await syncRecurringChildren(
          tx,
          {
            id: created.id,
            userId: d.userId,
            serviceId: d.serviceId,
            slotId: d.slotId,
            periodId: d.periodId,
            week: d.week,
            themeLabel: d.theme,
            enfants: d.enfants,
            accompagnants: d.accompagnants,
            validated: true,
          },
          // Gestionnaire : pas de délai de réservation (borne au présent).
          { cutoffISO: todayParisISO() },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, réessayez." };
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
 * Insert direct validé côté admin : pas de jauge ni de délai de réservation (le
 * gestionnaire peut réserver n'importe quel créneau FUTUR), mais on refuse une date
 * déjà passée. Un ponctuel n'a ni période ni jour : periodId=0, dayKey="" et week="".
 */
export async function createUniqueBookingAction(input: {
  serviceId: string;
  slotId: string;
  userId: string;
  enfants: number;
  accompagnants: number;
  theme: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireServiceManager(input.serviceId);
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
  // Gestionnaire : pas de délai, mais on n'autorise pas une date déjà passée.
  if (slot.slotDate && slot.slotDate.toISOString().slice(0, 10) < todayParisISO()) {
    return { ok: false, error: "Ce créneau est passé." };
  }
  try {
    await prisma.$transaction(
      async (tx) => {
        // Anti-surbooking : le gestionnaire ne peut pas dépasser la jauge/capacité.
        await assertSlotCapacity(tx, {
          serviceId: d.serviceId,
          slotId: d.slotId,
          bookingType: "unique",
          periodId: 0,
          enfants: d.enfants,
          accompagnants: d.accompagnants,
        });
        await tx.booking.create({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Cet usager a déjà une réservation sur ce créneau." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return { ok: false, error: "Réservation simultanée détectée, réessayez." };
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
  await requireServiceManager(input.serviceId);
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
      bookingType: true,
      parentBookingId: true,
      pointage: true,
    },
  });
  if (!src || src.serviceId !== input.serviceId) {
    return { ok: false, error: "Réservation introuvable." };
  }
  // Miroir non copiable ; source verrouillée par un pointage non plus.
  if (
    await bookingLocked({
      id: id.data,
      bookingType: src.bookingType,
      parentBookingId: src.parentBookingId,
      pointage: src.pointage,
    })
  ) {
    return { ok: false, error: "Réservation non copiable (séance pointée ou miroir)." };
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
  await requireServiceManager(input.serviceId);
  const res = await copyBookingAction(input);
  if (!res.ok) return res;
  const id = idSchema.safeParse(input.sourceBookingId);
  if (id.success) {
    // La copie est committée : si la suppression de la source échoue, on le DIT
    // (sinon : doublon silencieux consommant la jauge). Scopée au service (anti-IDOR).
    const del = await prisma.booking
      .deleteMany({ where: { id: id.data, serviceId: input.serviceId } })
      .catch(() => null);
    if (!del || del.count === 0) {
      revalidatePath(`/services/${input.serviceId}/agenda`);
      return {
        ok: false,
        error:
          "Réservation copiée, mais la source n'a pas pu être supprimée — retirez-la manuellement.",
      };
    }
  }
  revalidatePath(`/services/${input.serviceId}/agenda`);
  return { ok: true };
}
