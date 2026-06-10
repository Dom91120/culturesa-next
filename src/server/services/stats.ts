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
};

/** Date UTC → 'YYYY-MM-DD'. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const ISO_DAYKEY = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const DAY_ORDER = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};
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
  const periodsById = new Map<number, { dateStart: Date | null; dateEnd: Date | null }>(
    (
      await prisma.period.findMany({
        where: { serviceId },
        select: { id: true, dateStart: true, dateEnd: true },
      })
    ).map((p) => [p.id, { dateStart: p.dateStart, dateEnd: p.dateEnd }]),
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
      slot: { select: { slotDay: true, slotDate: true } },
      user: { select: { niveau: true, structure: { select: { label: true } } } },
    },
  });

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
  for (const b of vol) {
    const dk = dayKeyOf(b.slot.slotDay, b.slot.slotDate);
    if (dk) dayMap.set(dk, (dayMap.get(dk) ?? 0) + 1);
    // Mois : date du créneau (ponctuel) sinon début de période (récurrent), comme le legacy.
    const ref = b.slot.slotDate ?? periodsById.get(b.periodId)?.dateStart ?? null;
    if (ref) {
      const bucket = ymd(ref).slice(0, 7);
      monthMap.set(bucket, (monthMap.get(bucket) ?? 0) + 1);
    }
    structMap.set(
      b.user.structure?.label ?? "(sans structure)",
      (structMap.get(b.user.structure?.label ?? "(sans structure)") ?? 0) + 1,
    );
    const niv = b.user.niveau?.trim() || "(aucun)";
    niveauMap.set(niv, (niveauMap.get(niv) ?? 0) + 1);
  }

  const byDay = DAY_ORDER.filter((d) => dayMap.has(d)).map((d) => ({
    label: DAY_NAMES[d],
    value: dayMap.get(d) ?? 0,
  }));
  const byMonth = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => {
      const [y, m] = bucket.split("-");
      return { label: `${MONTH_NAMES[Number(m) - 1]} ${y}`, value };
    });

  // ── Population PRÉVU/RÉALISÉ (occurrences datées passées, validées) ────────────
  const occRows = await prisma.booking.findMany({
    where: { serviceId, validated: true, slot: { slotDate: { not: null } } },
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
  };
}
