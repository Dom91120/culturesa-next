import type { Prisma } from "@/generated/prisma/client";
import { earliestBookableISO } from "@/lib/booking-delay";
import { slotWeekTag } from "@/lib/iso-week";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import { effectiveOpenOnSchoolHolidays } from "@/server/services/bookings";
import { getSchoolZone, loadSchoolHolidayRanges } from "@/server/services/holidays";
import { EXERCICE_OPENING_SELECT } from "@/server/services/opening";

// ════════════════════════════════════════════════════════════
//  Matérialisation des réservations-enfants d'une récurrente (port legacy
//  bk_regenerate_mirrors). Une réservation récurrente « parente » (bookingType
//  "recurring", sur le slot parent) possède une réservation-ENFANT datée par
//  occurrence (bookingType "unique", sur le slot miroir), portant son propre
//  `pointage`. Ces helpers gardent les enfants en phase avec les miroirs.
//
//  Capacité : comptée sur le PARENT (les enfants ont periodId=0, hors du décompte).
//  Validation : héritée du parent (propagée ici). Pointage : JAMAIS touché ici.
// ════════════════════════════════════════════════════════════

export type ParentForSync = {
  id: number;
  userId: string;
  serviceId: string;
  slotId: string; // slot parent récurrent
  periodId: number | null; // période de la récurrente (null/≤0 = aucune → pas d'enfants)
  week: string; // "" | "A" | "B"
  themeLabel: string;
  enfants: number;
  accompagnants: number;
  validated: boolean;
};

/** Select Prisma alimentant `ParentForSync` — SOURCE UNIQUE (3 copies champ à
 * champ avant l'audit 2026-07-17 : ici + 2 actions de l'agenda admin). Étendre
 * `ParentForSync` = étendre CE select, les consommateurs suivent. */
export const PARENT_FOR_SYNC_SELECT = {
  id: true,
  userId: true,
  serviceId: true,
  slotId: true,
  periodId: true,
  week: true,
  themeLabel: true,
  enfants: true,
  accompagnants: true,
  validated: true,
} as const;

const toISO = (d: Date) => d.toISOString().slice(0, 10);

export { getSchoolZone };

/**
 * Cache partagé entre plusieurs appels de `syncRecurringChildren` au sein d'une MÊME
 * transaction (régénérations en boucle : période, exercice, bascule). Sans lui, chaque
 * parent refaisait ~6 requêtes identiques (vacances scolaires, ouverture d'exercice,
 * délai du service, politique du demandeur, miroirs du créneau) — O(périodes × slots ×
 * parents) requêtes séquentielles sous transaction Serializable (audit 2026-07-17).
 * Rempli PARESSEUSEMENT par syncRecurringChildren ; un appel unitaire sans cache garde
 * le comportement historique.
 */
export type SyncRecurringCache = {
  // Plages de vacances (zone unique de l'app), remplies au premier besoin.
  schoolRanges?: { dateStart: string; dateEnd: string }[];
  exerciceIdByPeriod: Map<number, number | null>;
  openingByExercice: Map<number, { activeDays: string; openOnSchoolHolidays: boolean } | null>;
  delayByService: Map<string, number>;
  openSchoolByUser: Map<string, boolean>;
  // Miroirs par couple slot parent | période (partagés entre parents du même créneau).
  mirrorsBySlotPeriod: Map<string, { id: string; slotDate: Date | null }[]>;
};

export function createSyncRecurringCache(): SyncRecurringCache {
  return {
    exerciceIdByPeriod: new Map(),
    openingByExercice: new Map(),
    delayByService: new Map(),
    openSchoolByUser: new Map(),
    mirrorsBySlotPeriod: new Map(),
  };
}

/**
 * Rend les enfants d'une réservation récurrente exactement conformes à ses
 * occurrences cibles (miroirs du slot parent dans la période, filtrés par la
 * semaine A/B et les vacances scolaires du demandeur de l'usager). Idempotent,
 * tx-scoped. Ne modifie jamais le `pointage` des enfants existants.
 */
export async function syncRecurringChildren(
  tx: Prisma.TransactionClient,
  parent: ParentForSync,
  // cutoffISO : date min de matérialisation. Fournie par les appels GESTIONNAIRE
  // (= aujourd'hui, pas de délai) ; à défaut, calculée depuis le délai du service
  // (comportement USAGER). cache : partage des lectures entre appels en boucle
  // (cf. SyncRecurringCache) — absent = comportement unitaire historique.
  opts?: { schoolZone?: string; cutoffISO?: string; cache?: SyncRecurringCache },
): Promise<{ created: number; updated: number; deleted: number }> {
  if (parent.periodId == null || parent.periodId <= 0) {
    const del = await tx.booking.deleteMany({ where: { parentBookingId: parent.id } });
    return { created: 0, updated: 0, deleted: del.count };
  }
  const cache = opts?.cache;

  // Politique vacances scolaires = combinaison EXERCICE ∧ DEMANDEUR : on ne matérialise
  // une occurrence en vacances que si l'exercice de la période de la récurrente ET le
  // demandeur acceptent les vacances. Période sans exercice = FERMÉ (rien à créer).
  let userOpenSchool = cache?.openSchoolByUser.get(parent.userId);
  if (userOpenSchool === undefined) {
    const user = await tx.user.findUnique({
      where: { id: parent.userId },
      select: {
        demandeur: { select: { openOnSchoolHolidays: true } },
        structure: { select: { demandeur: { select: { openOnSchoolHolidays: true } } } },
      },
    });
    userOpenSchool = effectiveOpenOnSchoolHolidays(user);
    cache?.openSchoolByUser.set(parent.userId, userOpenSchool);
  }
  let exerciceId = cache?.exerciceIdByPeriod.get(parent.periodId);
  if (exerciceId === undefined) {
    const period = await tx.period.findUnique({
      where: { id: parent.periodId },
      select: { exerciceId: true },
    });
    exerciceId = period?.exerciceId ?? null;
    cache?.exerciceIdByPeriod.set(parent.periodId, exerciceId);
  }
  let opening: { activeDays: string; openOnSchoolHolidays: boolean } | null = null;
  if (exerciceId != null) {
    const cached = cache?.openingByExercice.get(exerciceId);
    if (cached !== undefined) {
      opening = cached;
    } else {
      opening = await tx.exercice.findUnique({
        where: { id: exerciceId },
        select: EXERCICE_OPENING_SELECT,
      });
      cache?.openingByExercice.set(exerciceId, opening);
    }
  }
  const openOnSchool = (opening?.openOnSchoolHolidays ?? false) && userOpenSchool;
  let schoolRanges: { dateStart: string; dateEnd: string }[] = [];
  if (!openOnSchool) {
    if (cache?.schoolRanges) {
      schoolRanges = cache.schoolRanges;
    } else {
      const zone = opts?.schoolZone ?? (await getSchoolZone());
      schoolRanges = await loadSchoolHolidayRanges(tx, zone);
      if (cache) cache.schoolRanges = schoolRanges;
    }
  }
  // Convention vacances scolaires : dateStart = dernier jour d'école → borne gauche
  // stricte (cf. lib/school-holidays). Corrige un off-by-one qui excluait à tort une
  // occurrence tombant le dernier jour d'école.
  const inSchool = (d: string) => isInSchoolHolidayRange(d, schoolRanges);

  // Délai de réservation : on ne CRÉE pas d'enfant pour une occurrence antérieure à
  // aujourd'hui + le délai du service (cf. lib/booking-delay). On ne SUPPRIME jamais
  // un enfant déjà créé pour ce motif (préserve l'historique / le pointage des séances
  // passées) — seules les occurrences devenues invalides (semaine/fériés/vacances) le sont.
  let cutoff = opts?.cutoffISO;
  if (!cutoff) {
    let delay = cache?.delayByService.get(parent.serviceId);
    if (delay === undefined) {
      const svc = await tx.service.findUnique({
        where: { id: parent.serviceId },
        select: { bookingDelay: true },
      });
      delay = svc?.bookingDelay ?? 0;
      cache?.delayByService.set(parent.serviceId, delay);
    }
    // Jours ouvrés du délai = ceux de l'exercice de la période réservée (décision
    // produit). Période sans exercice → rien n'est matérialisable (cutoff infini).
    cutoff = opening
      ? earliestBookableISO(
          delay,
          opening.activeDays
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : "9999-12-31";
  }

  // Miroirs de la période : jours fériés + parité A/B du SLOT déjà exclus à leur
  // génération ; on applique ici le filtre A/B de la RÉSERVATION + vacances scolaires.
  // Partagés via le cache entre parents d'un même créneau.
  const mirrorsKey = `${parent.slotId}|${parent.periodId}`;
  let mirrors = cache?.mirrorsBySlotPeriod.get(mirrorsKey);
  if (mirrors === undefined) {
    mirrors = await tx.slot.findMany({
      where: {
        parentSlotId: parent.slotId,
        slotType: "unique",
        periodId: parent.periodId,
      },
      select: { id: true, slotDate: true },
    });
    cache?.mirrorsBySlotPeriod.set(mirrorsKey, mirrors);
  }

  const validIds: string[] = []; // occurrences valides (semaine / fériés / vacances)
  const createIds: string[] = []; // celles à matérialiser (≥ cutoff délai)
  for (const m of mirrors) {
    if (!m.slotDate) continue;
    const d = toISO(m.slotDate);
    if ((parent.week === "A" || parent.week === "B") && slotWeekTag(d) !== parent.week) continue;
    if (inSchool(d)) continue;
    validIds.push(m.id);
    if (d >= cutoff) createIds.push(m.id);
  }

  // Batch (anti-timeout) : l'ancien upsert PAR occurrence faisait N allers-retours SQL
  // dans la transaction. Même sémantique en 3 requêtes : les lignes existantes au sens
  // de l'unicité uq_recurring (enfants de CE parent OU ponctuelle autonome du même
  // usager sur le miroir) sont ADOPTÉES + alignées sur le parent (comme l'upsert),
  // les autres occurrences sont créées en un seul createMany.
  let created = 0;
  let updated = 0;
  if (createIds.length > 0) {
    const uqWhere = {
      userId: parent.userId,
      serviceId: parent.serviceId,
      // Enfants d'occurrence et ponctuelles autonomes ont periodId NULL (cf. uq_recurring
      // NULLS NOT DISTINCT) : on matche IS NULL pour l'adoption, pas l'ancien sentinelle 0.
      periodId: null,
      week: "",
    };
    const existingRows = await tx.booking.findMany({
      where: { ...uqWhere, slotId: { in: createIds } },
      select: { slotId: true },
    });
    const existingIds = existingRows.map((b) => b.slotId);
    if (existingIds.length > 0) {
      const upd = await tx.booking.updateMany({
        where: { ...uqWhere, slotId: { in: existingIds } },
        data: {
          parentBookingId: parent.id,
          themeLabel: parent.themeLabel,
          enfants: parent.enfants,
          accompagnants: parent.accompagnants,
          validated: parent.validated,
        },
      });
      updated = upd.count;
    }
    const existingSet = new Set(existingIds);
    const toCreate = createIds.filter((slotId) => !existingSet.has(slotId));
    if (toCreate.length > 0) {
      // skipDuplicates : une création concurrente entre le findMany et ici ne fait
      // pas échouer la transaction (l'unicité uq_recurring reste garantie par la base).
      const res = await tx.booking.createMany({
        data: toCreate.map((slotId) => ({
          bookingType: "unique",
          userId: parent.userId,
          serviceId: parent.serviceId,
          slotId,
          periodId: null,
          week: "",
          parentBookingId: parent.id,
          themeLabel: parent.themeLabel,
          enfants: parent.enfants,
          accompagnants: parent.accompagnants,
          validated: parent.validated,
          autoValidateFrom: null,
        })),
        skipDuplicates: true,
      });
      created = res.count;
    }
  }

  // Enfants dont l'occurrence n'est PLUS valide (semaine/fériés/vacances) → supprimés.
  // (On garde les enfants passés/dans le délai déjà créés : préservation du pointage.)
  const del =
    validIds.length > 0
      ? await tx.booking.deleteMany({
          where: { parentBookingId: parent.id, slotId: { notIn: validIds } },
        })
      : await tx.booking.deleteMany({ where: { parentBookingId: parent.id } });

  return { created, updated, deleted: del.count };
}

/**
 * Re-synchronise les enfants de TOUTES les réservations récurrentes parentes posées
 * sur un slot parent donné (à appeler après (re)génération de ses miroirs).
 */
export async function syncChildrenForRecurringSlot(
  tx: Prisma.TransactionClient,
  parentSlotId: string,
  opts?: { schoolZone?: string; cutoffISO?: string; cache?: SyncRecurringCache },
): Promise<void> {
  const parents = await tx.booking.findMany({
    where: { slotId: parentSlotId, bookingType: "recurring", parentBookingId: null },
    select: PARENT_FOR_SYNC_SELECT,
  });
  if (parents.length === 0) return;
  // Cache partagé entre les parents (et, si fourni par l'appelant, entre créneaux
  // d'une même régénération) : lectures répétées mutualisées.
  const cache = opts?.cache ?? createSyncRecurringCache();
  for (const p of parents)
    await syncRecurringChildren(tx, p, {
      schoolZone: opts?.schoolZone,
      cutoffISO: opts?.cutoffISO,
      cache,
    });
}
