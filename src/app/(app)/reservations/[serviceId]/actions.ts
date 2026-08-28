"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { earliestBookableISO, todayParisISO } from "@/lib/booking-delay";
import {
  bookingAccompagnantsSchema,
  bookingCreateSchema,
  bookingDetailSchema,
  bookingEnfantsSchema,
  bookingThemeSchema,
} from "@/schemas/booking";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/guards";
import {
  type BookingCancellationParams,
  type BookingConfirmationParams,
  sendBookingCancellationMail,
  sendBookingConfirmationMail,
} from "@/server/services/booking-mail";
import {
  assertBookingUnlocked,
  assertNotSchoolHolidayForUser,
  assertPeriodOpenForUser,
  assertReservationLimits,
  assertSlotCapacity,
  assertThemeIfRequired,
  BookingError,
  cancelUserBookingInTx,
  createUniqueBookingInTx,
  effectiveDemandeurId,
  isValidationMode,
  mapBookingError,
  userCanAccessService,
} from "@/server/services/bookings";
import { openingForDate } from "@/server/services/opening";
import {
  insertRecurringBookingInTx,
  resolveRecurringTarget,
} from "@/server/services/recurring-booking";
import { syncRecurringChildren } from "@/server/services/recurring-children";

function revalidate(serviceId: string) {
  revalidatePath(`/reservations/${serviceId}`);
}

type Result = { ok: boolean; error?: string };

// (mapBookingError : source unique dans server/services/bookings — audit 2026-07-17.)

// ── Cœurs transactionnels (composables dans UNE tx — panier atomique commitDraft) ──
// Chaque helper exécute validation + écritures d'UNE opération dans le `tx` fourni et
// lève BookingError en cas de refus. Les ADD renvoient les paramètres d'e-mail de
// confirmation (envoyés APRÈS le commit, best-effort).

async function reserveRecurringInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: {
    slotId: string;
    periodId: number;
    theme: string;
    enfants: number;
    accompagnants: number;
    // `wk` (parité annoncée) n'est plus utilisé : la parité de la réservation est dérivée
    // du créneau (Slot.weeks). Conservé pour compat des appelants.
    wk?: "A" | "B" | "";
  },
): Promise<BookingConfirmationParams> {
  const { slotId, periodId, theme, enfants, accompagnants } = args;
  // Résolution/validation du créneau cible : type récurrent, service, période
  // annoncée obligatoire et ÉGALE à celle du créneau (anti-injection : jauge et
  // unicité uq_recurring cloisonnées par {slotId, periodId}), parité dérivée du
  // créneau — source unique partagée avec l'agenda admin (recurring-booking.ts).
  const target = await resolveRecurringTarget(tx, { serviceId, slotId, periodId });
  // Accès service : le demandeur effectif de l'usager doit accepter ce service.
  if (!(await userCanAccessService(tx, userId, serviceId))) {
    throw new BookingError("Vous n'avez pas accès à ce service.");
  }
  // Disponibilité de la période (colonne « Dispo ») : pas encore ouverte → refus.
  await assertPeriodOpenForUser(tx, periodId);
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { enfants: true },
  });
  // Compteurs : valeurs saisies (jauge) si fournies, sinon profil.
  const myEnfants = enfants > 0 ? enfants : (user?.enfants ?? 0);
  const myAcc = accompagnants > 0 ? accompagnants : 0;
  // Une réservation doit compter au moins 1 enfant ET 1 accompagnant (cf.
  // schemas/booking.ts hasBothParticipants) — vérifié ICI sur les valeurs FINALES
  // (après repli sur le profil), le schéma d'entrée reserveRecurringSchema ne voit
  // que les valeurs brutes saisies.
  if (myEnfants < 1 || myAcc < 1) {
    throw new BookingError("Au moins 1 enfant et 1 accompagnant sont requis.");
  }
  // Demandeurs autorisés (SlotDemandeur) : évalués sur le demandeur EFFECTIF (le
  // sien, sinon celui de sa structure) — cohérent avec l'affichage de l'agenda
  // usager. Compte sans demandeur effectif (ex. admin) : autorisé.
  if (target.demandeurIds.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !target.demandeurIds.includes(demId)) {
      throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
    }
  }
  // Anti-surbooking : règle canonique partagée (assertSlotCapacity) — jauge =
  // enfants + adultes ; hors jauge = 1 par réservation.
  await assertSlotCapacity(tx, {
    serviceId,
    slotId,
    bookingType: "recurring",
    periodId,
    enfants: myEnfants,
    accompagnants: myAcc,
  });
  // Limites de réservation de l'usager (max par période + max sur l'exercice, lus
  // sur l'exercice de la période visée).
  await assertReservationLimits(tx, {
    serviceId,
    userId,
    periodId,
  });
  // Thème obligatoire (réglage du demandeur EFFECTIF) : refus si la saisie est vide.
  // Le formulaire l'annonce déjà, mais c'est ICI que la règle est tenue.
  await assertThemeIfRequired(tx, userId, serviceId, theme);
  // Validation : validée d'emblée sauf si le demandeur EFFECTIF est en mode validation.
  const validated = !(await isValidationMode(tx, userId, serviceId));
  // Insertion partagée (booking + réservations-enfants + paramètres d'e-mail).
  // Création par l'usager : confirmée d'emblée (validation off) ou demande en attente.
  return insertRecurringBookingInTx(tx, target, {
    userId,
    theme,
    enfants: myEnfants,
    accompagnants: myAcc,
    validated,
    trigger: validated ? "confirm_create" : "pending_create",
  });
}

async function reservePonctuelInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  args: { slotId: string; theme: string; enfants: number; accompagnants: number },
): Promise<BookingConfirmationParams | null> {
  // Anti-IDOR / cohérence de la validation : le créneau doit appartenir au service
  // annoncé. Sinon `validated` (dérivé de `serviceId`) porterait sur un service
  // autre que celui où la réservation est réellement créée (createUniqueBookingInTx
  // crée sur slot.serviceId) → contournement du mode validation.
  const targetSlot = await tx.slot.findUnique({
    where: { id: args.slotId },
    select: { serviceId: true },
  });
  if (!targetSlot || targetSlot.serviceId !== serviceId) {
    throw new BookingError("Ce créneau n'est pas disponible.");
  }
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { enfants: true },
  });
  await assertThemeIfRequired(tx, userId, serviceId, args.theme);
  const validated = !(await isValidationMode(tx, userId, serviceId));
  const myEnfants = args.enfants > 0 ? args.enfants : (user?.enfants ?? 0);
  const myAcc = args.accompagnants > 0 ? args.accompagnants : 0;
  const parsed = bookingCreateSchema.safeParse({
    slotId: args.slotId,
    enfants: myEnfants,
    accompagnants: myAcc,
    themeLabel: args.theme,
  });
  if (!parsed.success) {
    throw new BookingError(parsed.error.issues[0]?.message ?? "Données invalides.");
  }
  await createUniqueBookingInTx(tx, userId, parsed.data, validated);
  // Slot pour l'e-mail de confirmation (lu dans la même transaction).
  const slot = await tx.slot.findUnique({
    where: { id: args.slotId },
    select: {
      startTime: true,
      endTime: true,
      slotDate: true,
      slotDay: true,
      service: { select: { label: true } },
    },
  });
  if (!slot) return null;
  return {
    userId,
    serviceId,
    serviceLabel: slot.service.label,
    // Création par l'usager : confirmée d'emblée (validation off) ou demande en attente.
    trigger: validated ? "confirm_create" : "pending_create",
    slot: {
      startTime: slot.startTime,
      endTime: slot.endTime,
      slotDate: slot.slotDate,
      slotDay: slot.slotDay,
    },
    enfants: myEnfants,
    accompagnants: myAcc,
    theme: args.theme,
  };
}

/**
 * Annule une réservation appartenant à l'usager. Renvoie les paramètres de l'e-mail
 * « Réservation annulée » à envoyer APRÈS le commit (best-effort) UNIQUEMENT si la
 * réservation était VALIDÉE et a réellement été supprimée ; sinon `null`.
 */
async function cancelInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
): Promise<BookingCancellationParams | null> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
    select: {
      serviceId: true,
      validated: true,
      periodId: true,
      slotId: true,
      parentBookingId: true,
    },
  });
  if (!booking) throw new BookingError("Réservation introuvable.");
  // Occurrence ENFANT d'une récurrente : l'annulation porte sur la réservation
  // PARENTE entière (les séances ne s'annulent pas à l'unité côté usager —
  // supprimer un enfant seul laissait toutes les autres occurrences en place).
  if (booking.parentBookingId != null) {
    return cancelInTx(tx, userId, serviceId, booking.parentBookingId);
  }
  // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
  await assertBookingUnlocked(tx, userId, booking);
  const deleted = await cancelUserBookingInTx(tx, userId, bookingId);
  // E-mail d'annulation seulement pour une résa VALIDÉE effectivement supprimée.
  if (!deleted || !booking.validated) return null;
  return {
    userId,
    serviceId,
    slotId: booking.slotId,
    periodId: booking.periodId,
    motif: "Supprimée par l'utilisateur",
  };
}

/**
 * Déplace une réservation « en attente » de l'usager vers un autre créneau de MÊME type
 * (récurrent→récurrent, ponctuel→ponctuel), en conservant son id. La validation repasse
 * « en attente » selon le mode du demandeur (port du legacy `_userOnDrop` + `entry.moved`).
 */
async function moveInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
  // `week` (parité annoncée) n'est plus utilisé : la parité de la réservation est
  // dérivée du créneau cible (Slot.weeks), comme à la création. Conservé pour compat.
  target: { slotId: string; ponctuel: boolean; periodId?: number; week?: string },
): Promise<void> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
  });
  if (!booking) throw new BookingError("Réservation introuvable.");
  // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
  await assertBookingUnlocked(tx, userId, booking);
  // Créneau cible : récurrent = résolution partagée avec la création et l'agenda
  // admin (resolveRecurringTarget : type/service, période annoncée obligatoire et
  // égale à celle du créneau — anti-injection, parité dérivée du créneau, cf.
  // audit 2026-07-19) ; ponctuel = fetch local (restriction avec repli PARENT).
  let slotWeek: "" | "A" | "B" = "";
  let restriction: number[] = [];
  let uniqueSlot: { periodId: number | null; slotDate: Date | null } | null = null;
  if (!target.ponctuel) {
    const t = await resolveRecurringTarget(tx, {
      serviceId,
      slotId: target.slotId,
      periodId: target.periodId ?? 0,
    });
    slotWeek = t.week;
    restriction = t.demandeurIds;
  } else {
    const slot = await tx.slot.findUnique({
      where: { id: target.slotId },
      include: {
        demandeurs: { select: { demandeurId: true } },
        parent: { select: { demandeurs: { select: { demandeurId: true } } } },
      },
    });
    if (!slot || slot.serviceId !== serviceId || slot.slotType !== "unique") {
      throw new BookingError("Ce créneau n'est pas disponible.");
    }
    // Restriction du créneau, sinon celle de son PARENT pour un miroir (cohérent
    // avec createUniqueBookingInTx — un miroir ne porte pas ses propres lignes
    // SlotDemandeur).
    restriction = (slot.demandeurs.length ? slot.demandeurs : (slot.parent?.demandeurs ?? [])).map(
      (d) => d.demandeurId,
    );
    uniqueSlot = slot;
  }
  // Demandeurs autorisés (SlotDemandeur) : évalué sur le demandeur EFFECTIF (le sien,
  // sinon celui de sa structure). Compte sans demandeur effectif (ex. admin) : autorisé.
  if (restriction.length > 0) {
    const demId = await effectiveDemandeurId(tx, userId);
    if (demId != null && !restriction.includes(demId)) {
      throw new BookingError("Ce créneau est réservé à d'autres demandeurs.");
    }
  }
  // Disponibilité de la période CIBLE (colonne « Dispo ») : pas encore ouverte → refus.
  await assertPeriodOpenForUser(
    tx,
    target.ponctuel ? (uniqueSlot?.periodId ?? null) : target.periodId,
  );
  // Déplacement vers un créneau PONCTUEL daté : mêmes gardes de date que la création
  // (createUniqueBookingInTx) — date passée refusée, délai de réservation re-vérifié
  // (le move permettait sinon de contourner le délai : créer sur un créneau autorisé
  // puis glisser vers un créneau encore sous délai, ou vers une date passée — audit
  // 2026-07-19), vacances scolaires selon exercice ∧ demandeur. Date hors de tout
  // exercice = fermée.
  if (target.ponctuel) {
    const slotDate = uniqueSlot?.slotDate;
    if (!slotDate) throw new BookingError("Ce créneau n'est pas disponible.");
    const slotYmd = slotDate.toISOString().slice(0, 10);
    if (slotYmd < todayParisISO()) {
      throw new BookingError("Ce créneau est passé.");
    }
    const opening = await openingForDate(tx, serviceId, slotYmd);
    if (!opening) {
      throw new BookingError("Cette date n'est couverte par aucun exercice du service.");
    }
    const earliest = earliestBookableISO(
      // Délai porté par l'exercice couvrant la date (openingForDate).
      opening.bookingDelay,
      opening.activeDays
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    );
    if (slotYmd < earliest) {
      throw new BookingError("Le délai de réservation pour ce créneau n'est pas encore atteint.");
    }
    await assertNotSchoolHolidayForUser(tx, userId, slotDate, opening.openOnSchoolHolidays);
  }
  // Anti-surbooking : règle canonique partagée (assertSlotCapacity), la réservation
  // déplacée étant exclue du décompte.
  await assertSlotCapacity(tx, {
    serviceId,
    slotId: target.slotId,
    bookingType: target.ponctuel ? "unique" : "recurring",
    periodId: target.ponctuel ? 0 : (target.periodId ?? 0),
    enfants: booking.enfants,
    accompagnants: booking.accompagnants,
    excludeBookingId: bookingId,
  });
  // Limites de réservation de l'usager sur la période CIBLE (max par période + max
  // sur l'exercice) — omises jusqu'ici : un déplacement permettait de dépasser les
  // maxima en créant dans des périodes distinctes puis en regroupant sur une seule.
  // La résa déplacée est exclue du décompte (sinon faux rejet en move intra-exercice).
  await assertReservationLimits(tx, {
    serviceId,
    userId,
    periodId: target.ponctuel ? (uniqueSlot?.periodId ?? 0) : (target.periodId ?? 0),
    excludeBookingId: bookingId,
  });
  const validated = !(await isValidationMode(tx, userId, serviceId));
  const updated = await tx.booking.update({
    where: { id: bookingId },
    data: {
      slotId: target.slotId,
      // Ponctuel → aucune période (NULL) ; récurrent → période cible (validée plus haut).
      periodId: target.ponctuel ? null : (target.periodId ?? null),
      week: slotWeek,
      validated,
      autoValidateFrom: new Date(),
    },
  });
  if (target.ponctuel) {
    // Devient ponctuelle : plus d'occurrences → on retire d'éventuels enfants.
    await tx.booking.deleteMany({ where: { parentBookingId: bookingId } });
  } else {
    // Récurrente : régénère les enfants sur les nouveaux miroirs — la ligne mise à
    // jour EST le ParentForSync (plus de payload parallèle à maintenir en phase).
    await syncRecurringChildren(tx, updated);
  }
}

/**
 * Met à jour les compteurs / le thème d'une réservation appartenant à l'usager.
 * Mêmes garde-fous que l'équivalent admin (`updateBookingDetailAction`) : bornes
 * bornes/thème du schéma partagé, miroir non modifiable, réservation pointée refusée,
 * verrou « validation bloquante », et re-vérification de la jauge (anti-surbooking,
 * transaction sérialisable — gonfler les compteurs ne contourne pas la capacité).
 */
async function updateInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  bookingId: number,
  rawEnfants: number,
  rawAccompagnants: number,
  rawTheme: string,
): Promise<void> {
  // Bornes + invariant ≥1/≥1 : schéma UNIQUE partagé avec l'édition admin
  // (bookingDetailSchema) — remplace la validation manuelle divergente (0-99,
  // slice 255) relevée à l'audit 2026-07-17.
  const parsedDetail = bookingDetailSchema.safeParse({
    enfants: rawEnfants,
    accompagnants: rawAccompagnants,
    theme: rawTheme ?? "",
  });
  if (!parsedDetail.success) {
    throw new BookingError(parsedDetail.error.issues[0]?.message ?? "Données invalides.");
  }
  const { enfants: enf, accompagnants: acc, theme: themeLabel } = parsedDetail.data;
  // Vider le thème d'une réservation existante revient à la laisser sans thème : même
  // refus qu'à la création, sans quoi la règle se contournerait en deux temps.
  await assertThemeIfRequired(tx, userId, serviceId, themeLabel);
  const b = await tx.booking.findFirst({
    where: { id: bookingId, userId, serviceId },
    select: {
      id: true,
      bookingType: true,
      parentBookingId: true,
      pointage: true,
      userId: true,
      serviceId: true,
      slotId: true,
      periodId: true,
      week: true,
      validated: true,
    },
  });
  if (!b) throw new BookingError("Réservation introuvable.");
  if (b.parentBookingId != null) {
    throw new BookingError("Une séance (miroir) n'est pas modifiable.");
  }
  // Pointée (elle-même ou une de ses séances) → figée, comme l'annulation.
  if (b.pointage != null) throw new BookingError("Réservation pointée, non modifiable.");
  const pointedChildren = await tx.booking.count({
    where: { parentBookingId: b.id, pointage: { not: null } },
  });
  if (pointedChildren > 0) {
    throw new BookingError("Réservation pointée, non modifiable.");
  }
  // Validation bloquante : une résa validée (mode validation ON) est verrouillée.
  await assertBookingUnlocked(tx, userId, b);
  // Anti-surbooking : augmenter les compteurs ne doit pas dépasser la jauge/capacité
  // (la réservation courante est exclue du décompte).
  await assertSlotCapacity(tx, {
    serviceId,
    slotId: b.slotId,
    bookingType: b.bookingType === "recurring" ? "recurring" : "unique",
    periodId: b.periodId,
    enfants: enf,
    accompagnants: acc,
    excludeBookingId: b.id,
  });
  await tx.booking.update({
    where: { id: b.id },
    data: { enfants: enf, accompagnants: acc, themeLabel },
  });
  // Récurrente : propage counts/thème aux réservations-enfants.
  if (b.bookingType === "recurring") {
    await syncRecurringChildren(tx, {
      id: b.id,
      userId: b.userId,
      serviceId: b.serviceId,
      slotId: b.slotId,
      periodId: b.periodId,
      week: b.week,
      themeLabel,
      enfants: enf,
      accompagnants: acc,
      validated: b.validated,
    });
  }
}

// ── Panier ATOMIQUE : valide tout le brouillon en UNE transaction (tout ou rien) ──
// Tableaux BORNÉS (audit 2026-07-19) : chaque opération déclenche plusieurs requêtes
// dans une transaction sérialisable — un brouillon non borné permettait une transaction
// arbitrairement longue (contention/DoS). Le verrou « une action par cycle » côté UI
// (guardSingleAction) garde les brouillons légitimes très en deçà de 50.
const MAX_DRAFT_OPS = 50;
const draftSchema = z.object({
  removals: z.array(z.coerce.number().int().positive()).max(MAX_DRAFT_OPS).default([]),
  updates: z
    .array(
      z.object({
        bookingId: z.coerce.number().int().positive(),
        // Bornes UNIQUES 0-999 (schemas/booking) — ce sous-schéma ne bornait rien
        // et reposait sur le garde runtime (audit 2026-07-17).
        enfants: bookingEnfantsSchema,
        accompagnants: bookingAccompagnantsSchema,
        theme: bookingThemeSchema.default(""),
      }),
    )
    .max(MAX_DRAFT_OPS)
    .default([]),
  moves: z
    .array(
      z.object({
        bookingId: z.coerce.number().int().positive(),
        slotId: z.string().trim().min(1),
        ponctuel: z.boolean(),
        periodId: z.coerce.number().int().optional(),
        week: z.string().optional(),
      }),
    )
    .max(MAX_DRAFT_OPS)
    .default([]),
  adds: z
    .array(
      z.object({
        ponctuel: z.boolean(),
        slotId: z.string().trim().min(1),
        periodId: z.coerce.number().int().optional(),
        week: z.string().optional(),
        // Fragments UNIQUES (schemas/booking) — seul l'ajout récurrent stockait la
        // chaîne brute sans borne, propagée à tous les enfants (audit 2026-07-17).
        theme: bookingThemeSchema.default(""),
        enfants: bookingEnfantsSchema.default(0),
        accompagnants: bookingAccompagnantsSchema.default(0),
      }),
    )
    .max(MAX_DRAFT_OPS)
    .default([]),
});

/**
 * Enregistre TOUT le brouillon du panier en UNE seule transaction sérialisable :
 * suppressions → modifications → déplacements → ajouts (l'ordre libère des places
 * avant les ajouts). Tout ou rien : si une opération échoue, l'ensemble est annulé
 * et rien n'est appliqué. Les e-mails de confirmation des ajouts partent APRÈS le
 * commit (best-effort), comme pour les actions mono-op.
 */
type ParsedDraft = z.infer<typeof draftSchema>;

/**
 * Cœur transactionnel du panier (composable / testable hors auth) : applique tout le
 * brouillon dans le `tx` fourni, dans l'ordre suppressions → modifications →
 * déplacements → ajouts. Lève à la première erreur (→ rollback de toute la tx).
 * Renvoie les e-mails de confirmation à envoyer après le commit.
 */
// NON exporté : dans un fichier "use server", tout export devient un endpoint POST
// public — celui-ci prend userId en paramètre et n'a AUCUNE garde (elle est portée
// par commitDraft). Usage strictement interne (audit sécurité 2026-07-17).
async function commitDraftInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceId: string,
  draft: ParsedDraft,
): Promise<{
  confirmations: BookingConfirmationParams[];
  cancellations: BookingCancellationParams[];
}> {
  const mails: BookingConfirmationParams[] = [];
  const cancellations: BookingCancellationParams[] = [];
  for (const id of draft.removals) {
    const cancel = await cancelInTx(tx, userId, serviceId, id);
    if (cancel) cancellations.push(cancel);
  }
  for (const u of draft.updates) {
    await updateInTx(tx, userId, serviceId, u.bookingId, u.enfants, u.accompagnants, u.theme);
  }
  for (const m of draft.moves) {
    await moveInTx(tx, userId, serviceId, m.bookingId, {
      slotId: m.slotId,
      ponctuel: m.ponctuel,
      periodId: m.periodId,
      week: m.week,
    });
  }
  for (const a of draft.adds) {
    if (a.ponctuel) {
      const mp = await reservePonctuelInTx(tx, userId, serviceId, {
        slotId: a.slotId,
        theme: a.theme,
        enfants: a.enfants,
        accompagnants: a.accompagnants,
      });
      if (mp) mails.push(mp);
    } else {
      mails.push(
        await reserveRecurringInTx(tx, userId, serviceId, {
          slotId: a.slotId,
          periodId: a.periodId ?? 0,
          theme: a.theme,
          enfants: a.enfants,
          accompagnants: a.accompagnants,
          wk: a.week === "A" || a.week === "B" ? a.week : "",
        }),
      );
    }
  }
  return { confirmations: mails, cancellations };
}

export async function commitDraft(serviceId: string, rawDraft: unknown): Promise<Result> {
  const session = await requireUser();
  const parsed = draftSchema.safeParse(rawDraft);
  if (!parsed.success) return { ok: false, error: "Brouillon invalide." };
  let confirmations: BookingConfirmationParams[] = [];
  let cancellations: BookingCancellationParams[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        const res = await commitDraftInTx(tx, session.user.id, serviceId, parsed.data);
        confirmations = res.confirmations;
        cancellations = res.cancellations;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (e) {
    return mapBookingError(e);
  }
  // Notifications best-effort, après commit : confirmations d'ajout + annulations de résas validées.
  for (const m of confirmations) await sendBookingConfirmationMail(m);
  for (const c of cancellations) await sendBookingCancellationMail(c);
  revalidate(serviceId);
  return { ok: true };
}
