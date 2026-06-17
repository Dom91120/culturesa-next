import { DAY_NAMES } from "@/lib/agenda-core";
import { gaugeUnits } from "@/lib/gauge";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";

// =====================================================================================
// Statistiques d'un service. Agrégation 100 % serveur, sans dépendance de graphes :
// la page rend des barres CSS. Deux populations distinctes :
//   • VOLUME (réservations, jours, mois, structures, niveaux) → on EXCLUT les miroirs
//     (parentBookingId null) pour ne pas compter deux fois une récurrente.
//   • PRÉVU/RÉALISÉ (pointage) → occurrences DATÉES PASSÉES validées (ponctuels autonomes
//     + miroirs des récurrentes), car c'est là que vit le `pointage`.
// =====================================================================================

export type StatsType = "all" | "rec" | "uniq";

export type StatsFilters = {
  type: StatsType;
  dateFrom: string | null; // YYYY-MM-DD inclus
  dateTo: string | null; // YYYY-MM-DD inclus
};

export type LabeledCount = { label: string; value: number; color?: string };

export type ServiceStats = {
  total: number;
  distinctUsers: number;
  pending: number;
  enfants: number;
  accompagnants: number;
  // Prévu / réalisé (séances datées passées, validées)
  prevu: number;
  presents: number;
  absents: number;
  nonPointes: number;
  tauxPresence: number | null; // présents / (présents + absents)
  tauxRealisation: number | null; // présents / prévu
  // Graphes
  byDay: LabeledCount[];
  byMonth: LabeledCount[];
  topStructures: LabeledCount[];
  topNiveaux: LabeledCount[];
  // Taux de remplissage moyen (%, unités de jauge) des créneaux réservés, par structure.
  fillByStructure: LabeledCount[];
  // Effectifs (enfants) par exercice — TOUS exercices (ignore la plage de dates), pour
  // suivre l'évolution d'une année scolaire à l'autre. Respecte le filtre de type.
  effectifsByExercice: LabeledCount[];
};

/** Date UTC → 'YYYY-MM-DD'. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const ISO_DAYKEY = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
// Libellés de jours : source unique = DAY_NAMES (lib/agenda-core, pur — audit D2).
const MONTH_NAMES = [
  "Janv.",
  "Févr.",
  "Mars",
  "Avr.",
  "Mai",
  "Juin",
  "Juil.",
  "Août",
  "Sept.",
  "Oct.",
  "Nov.",
  "Déc.",
];

function inRange(d: string, from: string | null, to: string | null): boolean {
  return (!from || d >= from) && (!to || d <= to);
}

/** Jour de la semaine ('lun'..'dim') d'une réservation : slotDay (récurrent) ou date. */
function dayKeyOf(slotDay: string | null, slotDate: Date | null): string | null {
  if (slotDay) return slotDay;
  if (slotDate) return ISO_DAYKEY[slotDate.getUTCDay()];
  return null;
}

/** Libellé d'exercice « année scolaire » Y-Y+1 d'une date (mois ≥ août → Y, sinon Y-1). */
function schoolYearLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const ssy = d.getUTCMonth() + 1 >= 8 ? y : y - 1;
  return `${ssy}-${ssy + 1}`;
}

function topN(map: Map<string, number>, n: number): LabeledCount[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export async function getServiceStats(
  serviceId: string,
  filters: StatsFilters,
): Promise<ServiceStats> {
  const { type, dateFrom, dateTo } = filters;
  const today = ymd(new Date());

  // Dates des périodes du service (Booking n'a pas de relation `period` : periodId peut
  // valoir 0 pour un ponctuel). Sert à dater les réservations récurrentes (sans slotDate).
  const periodRows = await prisma.period.findMany({
    where: { serviceId },
    select: { id: true, dateStart: true, dateEnd: true, exercice: { select: { label: true } } },
  });
  const periodsById = new Map<number, { dateStart: Date | null; dateEnd: Date | null }>(
    periodRows.map((p) => [p.id, { dateStart: p.dateStart, dateEnd: p.dateEnd }]),
  );
  // periodId → libellé d'exercice (pour l'évolution des effectifs par exercice).
  const exoByPeriod = new Map<number, string>(
    periodRows.filter((p) => p.exercice?.label).map((p) => [p.id, p.exercice?.label ?? ""]),
  );

  // ── Population VOLUME (hors miroirs) ──────────────────────────────────────────
  const volumeRows = await prisma.booking.findMany({
    where: { serviceId, parentBookingId: null },
    select: {
      validated: true,
      enfants: true,
      accompagnants: true,
      userId: true,
      bookingType: true,
      periodId: true,
      slotId: true,
      slot: { select: { slotDay: true, slotDate: true, capacity: true } },
      user: {
        select: {
          niveau: true,
          structure: { select: { label: true } },
          // Repli « Top structures » : demandeur si l'usager n'a pas de structure.
          demandeur: { select: { label: true } },
        },
      },
    },
  });

  // Service : capacité par défaut + prise en compte des accompagnants dans la jauge.
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { capacity: true, gaugeAccompagnants: true },
  });
  const serviceCapacity = service?.capacity ?? 1;
  const gaugeAccompagnants = service?.gaugeAccompagnants ?? true;

  const volPass = (b: (typeof volumeRows)[number]): boolean => {
    if (type === "rec" && b.bookingType !== "recurring") return false;
    if (type === "uniq" && b.bookingType !== "unique") return false;
    if (!dateFrom && !dateTo) return true;
    if (b.slot.slotDate) return inRange(ymd(b.slot.slotDate), dateFrom, dateTo);
    // Récurrent (pas de date) : recoupement par les dates de sa période.
    const per = periodsById.get(b.periodId);
    const ps = per?.dateStart ? ymd(per.dateStart) : null;
    const pe = per?.dateEnd ? ymd(per.dateEnd) : null;
    if (!ps || !pe) return true;
    return (!dateTo || ps <= dateTo) && (!dateFrom || pe >= dateFrom);
  };
  const vol = volumeRows.filter(volPass);

  const total = vol.length;
  const distinctUsers = new Set(vol.map((b) => b.userId)).size;
  const pending = vol.filter((b) => !b.validated).length;
  const enfants = vol.reduce((s, b) => s + b.enfants, 0);
  const accompagnants = vol.reduce((s, b) => s + b.accompagnants, 0);

  const dayMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const structMap = new Map<string, number>();
  const niveauMap = new Map<string, number>();
  // Pour le remplissage : occupation (unités de jauge) et capacité par créneau.
  const occBySlot = new Map<string, number>();
  const capBySlot = new Map<string, number>();
  for (const b of vol) {
    const dk = dayKeyOf(b.slot.slotDay, b.slot.slotDate);
    if (dk) dayMap.set(dk, (dayMap.get(dk) ?? 0) + 1);
    capBySlot.set(b.slotId, b.slot.capacity ?? serviceCapacity);
    occBySlot.set(
      b.slotId,
      (occBySlot.get(b.slotId) ?? 0) + gaugeUnits(b.enfants, b.accompagnants, gaugeAccompagnants),
    );
    // Mois : date du créneau (ponctuel) sinon début de période (récurrent), comme le legacy.
    const ref = b.slot.slotDate ?? periodsById.get(b.periodId)?.dateStart ?? null;
    if (ref) {
      const bucket = ymd(ref).slice(0, 7);
      monthMap.set(bucket, (monthMap.get(bucket) ?? 0) + 1);
    }
    // Structure de l'usager, repli sur son demandeur (cohérent avec les éditions/legacy) ;
    // « (sans structure) » réservé aux usagers sans structure NI demandeur.
    const struct = b.user.structure?.label || b.user.demandeur?.label || "(sans structure)";
    structMap.set(struct, (structMap.get(struct) ?? 0) + 1);
    const niv = b.user.niveau?.trim() || "(aucun)";
    niveauMap.set(niv, (niveauMap.get(niv) ?? 0) + 1);
  }

  const byDay = DAYS.filter((d) => dayMap.has(d)).map((d) => ({
    label: DAY_NAMES[d],
    value: dayMap.get(d) ?? 0,
  }));
  const byMonth = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => {
      const [y, m] = bucket.split("-");
      return { label: `${MONTH_NAMES[Number(m) - 1]} ${y}`, value };
    });

  // Taux de remplissage moyen par structure : pour chaque réservation, remplissage du
  // créneau (occupation jauge / capacité, plafonné à 100 %) ; moyenne par structure.
  const fillSum = new Map<string, number>();
  const fillCnt = new Map<string, number>();
  for (const b of vol) {
    const cap = capBySlot.get(b.slotId) ?? 0;
    if (cap <= 0) continue;
    const fill = Math.min(100, (100 * (occBySlot.get(b.slotId) ?? 0)) / cap);
    const s = b.user.structure?.label || b.user.demandeur?.label || "(sans structure)";
    fillSum.set(s, (fillSum.get(s) ?? 0) + fill);
    fillCnt.set(s, (fillCnt.get(s) ?? 0) + 1);
  }
  const fillByStructure = [...fillSum.entries()]
    .map(([label, sum]) => ({ label, value: Math.round(sum / (fillCnt.get(label) ?? 1)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Effectifs (enfants) par exercice — TOUS exercices (pas de filtre de dates), filtre type.
  const exoMap = new Map<string, number>();
  for (const b of volumeRows) {
    if (type === "rec" && b.bookingType !== "recurring") continue;
    if (type === "uniq" && b.bookingType !== "unique") continue;
    const label = b.slot.slotDate
      ? schoolYearLabel(b.slot.slotDate)
      : (exoByPeriod.get(b.periodId) ?? null);
    if (!label) continue;
    exoMap.set(label, (exoMap.get(label) ?? 0) + b.enfants);
  }
  const effectifsByExercice = [...exoMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  // ── Population PRÉVU/RÉALISÉ (occurrences datées passées, validées) ────────────
  // Bornes poussées en base : on ne charge que les occurrences PASSÉES (≤ today) qui
  // recoupent [dateFrom, dateTo], au lieu de tout l'historique daté du service. Le
  // filtre en mémoire ci-dessous est conservé, identique, comme garde-fou.
  const occUpper = dateTo && dateTo < today ? dateTo : today;
  const occRows = await prisma.booking.findMany({
    where: {
      serviceId,
      validated: true,
      slot: {
        slotDate: {
          not: null,
          ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
          lte: new Date(`${occUpper}T00:00:00.000Z`),
        },
      },
    },
    select: { pointage: true, parentBookingId: true, slot: { select: { slotDate: true } } },
  });
  const occ = occRows.filter((o) => {
    if (!o.slot.slotDate) return false;
    const d = ymd(o.slot.slotDate);
    if (d > today) return false; // « prévu » = séances PASSÉES (attendance possible)
    if (type === "rec" && o.parentBookingId == null) return false; // miroir = occurrence récurrente
    if (type === "uniq" && o.parentBookingId != null) return false; // ponctuel autonome
    return inRange(d, dateFrom, dateTo);
  });
  const prevu = occ.length;
  const presents = occ.filter((o) => o.pointage === "present").length;
  const absents = occ.filter((o) => o.pointage === "absent").length;
  const nonPointes = prevu - presents - absents;
  const tauxPresence =
    presents + absents > 0 ? Math.round((100 * presents) / (presents + absents)) : null;
  const tauxRealisation = prevu > 0 ? Math.round((100 * presents) / prevu) : null;

  return {
    total,
    distinctUsers,
    pending,
    enfants,
    accompagnants,
    prevu,
    presents,
    absents,
    nonPointes,
    tauxPresence,
    tauxRealisation,
    byDay,
    byMonth,
    topStructures: topN(structMap, 10),
    topNiveaux: topN(niveauMap, 10),
    fillByStructure,
    effectifsByExercice,
  };
}
