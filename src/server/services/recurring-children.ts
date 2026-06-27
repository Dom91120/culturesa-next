import type { Prisma } from "@/generated/prisma/client";
import { earliestBookableISO } from "@/lib/booking-delay";
import { slotWeekTag } from "@/lib/iso-week";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";
import { getConfigMany } from "@/server/config";
import { effectiveOpenOnSchoolHolidays } from "@/server/services/bookings";

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
  periodId: number; // > 0
  week: string; // "" | "A" | "B"
  themeLabel: string;
  enfants: number;
  accompagnants: number;
  validated: boolean;
};

const toISO = (d: Date) => d.toISOString().slice(0, 10);

/** Zone de vacances scolaires configurée (défaut "A"). */
export async function getSchoolZone(): Promise<string> {
  const cfg = await getConfigMany(["school.zone"]);
  return cfg["school.zone"] || "A";
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
  // (comportement USAGER).
  opts?: { schoolZone?: string; cutoffISO?: string },
): Promise<{ created: number; updated: number; deleted: number }> {
  if (parent.periodId <= 0) {
    const del = await tx.booking.deleteMany({ where: { parentBookingId: parent.id } });
    return { created: 0, updated: 0, deleted: del.count };
  }

  // Politique vacances scolaires = combinaison SERVICE ∧ DEMANDEUR : on ne matérialise une
  // occurrence en vacances que si le service ET le demandeur acceptent les vacances.
  const [user, svc] = await Promise.all([
    tx.user.findUnique({
      where: { id: parent.userId },
      select: {
        demandeur: { select: { openOnSchoolHolidays: true } },
        structure: { select: { demandeur: { select: { openOnSchoolHolidays: true } } } },
      },
    }),
    tx.service.findUnique({
      where: { id: parent.serviceId },
      select: { openOnSchoolHolidays: true },
    }),
  ]);
  const openOnSchool = (svc?.openOnSchoolHolidays ?? false) && effectiveOpenOnSchoolHolidays(user);
  let schoolRanges: { dateStart: string; dateEnd: string }[] = [];
  if (!openOnSchool) {
    const zone = opts?.schoolZone ?? (await getSchoolZone());
    schoolRanges = (
      await tx.schoolHoliday.findMany({
        where: { zone },
        select: { dateStart: true, dateEnd: true },
      })
    ).map((r) => ({ dateStart: toISO(r.dateStart), dateEnd: toISO(r.dateEnd) }));
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
    const svc = await tx.service.findUnique({
      where: { id: parent.serviceId },
      select: { bookingDelay: true, activeDays: true },
    });
    cutoff = earliestBookableISO(
      svc?.bookingDelay ?? 0,
      (svc?.activeDays ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  // Miroirs de la période : jours fériés + parité A/B du SLOT déjà exclus à leur
  // génération ; on applique ici le filtre A/B de la RÉSERVATION + vacances scolaires.
  const mirrors = await tx.slot.findMany({
    where: {
      parentSlotId: parent.slotId,
      slotType: "unique",
      state: "actif",
      periodId: parent.periodId,
    },
    select: { id: true, slotDate: true },
  });

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
      periodId: 0,
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
          periodId: 0,
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
  opts?: { schoolZone?: string; cutoffISO?: string },
): Promise<void> {
  const parents = await tx.booking.findMany({
    where: { slotId: parentSlotId, bookingType: "recurring", parentBookingId: null },
    select: {
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
    },
  });
  if (parents.length === 0) return;
  const zone = opts?.schoolZone ?? (await getSchoolZone());
  for (const p of parents)
    await syncRecurringChildren(tx, p, { schoolZone: zone, cutoffISO: opts?.cutoffISO });
}
