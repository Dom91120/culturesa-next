import { DAY_NAMES, ISO_DAY_KEYS } from "@/lib/agenda-core";
import { todayParisISO } from "@/lib/booking-delay";
import { gaugeUnits } from "@/lib/gauge";
import { schoolYearLabel } from "@/lib/school-year";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";

// =====================================================================================
// Statistiques d'un service. Agrégation 100 % serveur, sans dépendance de graphes :
// la page rend des barres/anneaux CSS. TOUT est compté sur les OCCURRENCES DATÉES
// (« séances ») : ponctuels autonomes + miroirs des récurrentes — un récurrent hebdo
// compte donc une fois PAR occurrence. `occAll` = tout l'historique daté du service ;
// `occ` = filtré au type et à la plage de dates. Le pointage (prévu/réalisé) vit sur ces
// mêmes occurrences (séances passées, plus toute séance pointée — validée ou non).
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
  // Répartition par type sur les OCCURRENCES — anneau « Type de réservation » (miroir =
  // récurrente, ponctuel autonome = ponctuelle).
  recurringCount: number;
  uniqueCount: number;
  // Remplissage moyen GLOBAL des créneaux réservés (%, unités de jauge) ; null si aucun.
  avgFill: number | null;
  // Prévu / réalisé (séances datées passées, validées)
  prevu: number;
  presents: number;
  absents: number;
  nonPointes: number;
  tauxPresence: number | null; // présents / (présents + absents)
  tauxAbsence: number | null; // absents / (présents + absents)
  tauxRealisation: number | null; // présents / prévu
  // Graphes
  byDay: LabeledCount[];
  byMonth: LabeledCount[];
  // Remplissage moyen (%, unités de jauge) des SÉANCES datées, par mois — évolution du
  // taux d'occupation au fil de l'exercice.
  fillByMonth: LabeledCount[];
  topStructures: LabeledCount[];
  topNiveaux: LabeledCount[];
  // Répartition par thème (texte saisi/choisi par l'usager) — occurrences ayant un thème
  // non vide. topThemes = top 10 (comme topStructures/topNiveaux, pas de normalisation de
  // casse en mode « libre ») ; themedCount = total RÉEL (toutes occurrences avec thème, pas
  // seulement le top 10) pour un centre d'anneau exact.
  topThemes: LabeledCount[];
  themedCount: number;
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
  if (slotDate) return ISO_DAY_KEYS[slotDate.getUTCDay()];
  return null;
}

// Raccourcit les libellés de structure/demandeur pour l'affichage des stats (colonnes
// étroites) : « (É)cole maternelle » → « Maternelle », « (É)cole élémentaire » →
// « Élémentaire », « Accueil de loisir(s) » → « ADL ». Insensible casse/accents/pluriel ;
// seul le préfixe est remplacé, le reste (nom propre) est conservé.
const LABEL_SHORTCUTS: [RegExp, string][] = [
  [/[eé]cole maternelle/i, "Maternelle"],
  [/[eé]cole [eé]l[eé]mentaire/i, "Élémentaire"],
  [/accueil de loisirs?/i, "ADL"],
  [/Langevin-Wallon/i, "LW"],
];
function shortStructureLabel(label: string): string {
  let out = label;
  for (const [re, rep] of LABEL_SHORTCUTS) out = out.replace(re, rep);
  return out.trim();
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
  // « Aujourd'hui » = date calendaire à Paris (standardisation serveur, audit 2026-07-17).
  const today = todayParisISO();

  // Service : capacité par défaut + prise en compte des accompagnants dans la jauge.
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { capacity: true, gaugeAccompagnants: true },
  });
  const serviceCapacity = service?.capacity ?? 1;
  const gaugeAccompagnants = service?.gaugeAccompagnants ?? true;

  // Jauge DU CRÉNEAU (même règle que assertSlotCapacity et les grilles) :
  // l'occupation ne se compte en unités-jauge (enfants + accompagnants selon
  // gaugeAccompagnants) QUE si le créneau de l'occurrence a la jauge (slots.jauge) ;
  // sinon 1 par occurrence.
  const occUnits = (enfants: number, accompagnants: number, slotJauge: boolean): number =>
    slotJauge ? gaugeUnits(enfants, accompagnants, gaugeAccompagnants) : 1;

  // ── Population OCCURRENCES DATÉES ─────────────────────────────────────────────
  // TOUTES les stats se comptent sur les SÉANCES datées : ponctuels autonomes
  // (parentBookingId null) + miroirs des récurrentes (parentBookingId non null). Un
  // récurrent hebdo compte donc une fois PAR occurrence. `occAll` = tout l'historique daté
  // du service (évolution par exercice) ; `occ` = filtré au type + à la plage [from, to].
  const occAll = await prisma.booking.findMany({
    where: { serviceId, slot: { slotDate: { not: null } } },
    select: {
      validated: true,
      pointage: true,
      enfants: true,
      accompagnants: true,
      themeLabel: true,
      userId: true,
      parentBookingId: true,
      slot: {
        select: {
          id: true,
          parentSlotId: true,
          slotDay: true,
          slotDate: true,
          capacity: true,
          jauge: true,
        },
      },
      user: {
        select: {
          niveau: true,
          structure: { select: { label: true } },
          // Repli « structures » : demandeur si l'usager n'a pas de structure.
          demandeur: { select: { label: true } },
        },
      },
    },
  });
  // Filtre type : miroir = récurrente, ponctuel autonome = ponctuelle.
  const typePass = (b: (typeof occAll)[number]): boolean =>
    type === "rec" ? b.parentBookingId != null : type === "uniq" ? b.parentBookingId == null : true;
  // Population de travail : occurrences du type demandé, dans la plage de dates.
  const occ = occAll.filter(
    (b) =>
      b.slot.slotDate != null && typePass(b) && inRange(ymd(b.slot.slotDate), dateFrom, dateTo),
  );
  const structOf = (b: (typeof occAll)[number]): string =>
    b.user.structure?.label || b.user.demandeur?.label || "(sans structure)";
  const sessionKeyOf = (b: (typeof occAll)[number], dateStr: string): string =>
    `${b.slot.parentSlotId ?? b.slot.id}|${dateStr}`;

  const total = occ.length;
  const distinctUsers = new Set(occ.map((b) => b.userId)).size;
  const pending = occ.filter((b) => !b.validated).length;
  const enfants = occ.reduce((s, b) => s + b.enfants, 0);
  const accompagnants = occ.reduce((s, b) => s + b.accompagnants, 0);
  const recurringCount = occ.filter((b) => b.parentBookingId != null).length;
  const uniqueCount = occ.filter((b) => b.parentBookingId == null).length;

  // Répartitions (jour / structures / niveaux) + comptage mensuel + agrégats par SÉANCE
  // (= créneau récurrent parent ?? créneau, + date) pour le remplissage.
  const dayMap = new Map<string, number>();
  const structMap = new Map<string, number>();
  const niveauMap = new Map<string, number>();
  const themeMap = new Map<string, number>();
  const monthCount = new Map<string, number>();
  const sessionAgg = new Map<string, { occ: number; cap: number; month: string }>();
  for (const b of occ) {
    if (!b.slot.slotDate) continue;
    const dateStr = ymd(b.slot.slotDate);
    const dk = dayKeyOf(b.slot.slotDay, b.slot.slotDate);
    if (dk) dayMap.set(dk, (dayMap.get(dk) ?? 0) + 1);
    structMap.set(structOf(b), (structMap.get(structOf(b)) ?? 0) + 1);
    const niv = b.user.niveau?.trim() || "(aucun)";
    niveauMap.set(niv, (niveauMap.get(niv) ?? 0) + 1);
    // Thème : seules les occurrences ayant EFFECTIVEMENT un thème saisi comptent (pas de
    // catégorie "(sans thème)" — sur un service sans thèmes, ça noierait le panneau).
    const theme = b.themeLabel?.trim();
    if (theme) themeMap.set(theme, (themeMap.get(theme) ?? 0) + 1);
    const bucket = dateStr.slice(0, 7);
    monthCount.set(bucket, (monthCount.get(bucket) ?? 0) + 1);
    const key = sessionKeyOf(b, dateStr);
    const cur = sessionAgg.get(key) ?? {
      occ: 0,
      cap: b.slot.capacity ?? serviceCapacity,
      month: bucket,
    };
    cur.occ += occUnits(b.enfants, b.accompagnants, b.slot.jauge);
    sessionAgg.set(key, cur);
  }

  const byDay = DAYS.filter((d) => dayMap.has(d)).map((d) => ({
    label: DAY_NAMES[d],
    value: dayMap.get(d) ?? 0,
  }));

  // Remplissage % par SÉANCE : min(100, occupation jauge / capacité).
  const sessionFill = new Map<string, number>();
  for (const [k, s] of sessionAgg) {
    if (s.cap > 0) sessionFill.set(k, Math.min(100, (100 * s.occ) / s.cap));
  }

  // Remplissage moyen GLOBAL : moyenne des séances réservées.
  let fillTotG = 0;
  let fillNG = 0;
  for (const f of sessionFill.values()) {
    fillTotG += f;
    fillNG += 1;
  }
  const avgFill = fillNG > 0 ? Math.round(fillTotG / fillNG) : null;

  // Remplissage moyen par mois : moyenne des séances de chaque mois.
  const monthFillSum = new Map<string, number>();
  const monthFillCnt = new Map<string, number>();
  for (const [k, s] of sessionAgg) {
    const f = sessionFill.get(k);
    if (f == null) continue;
    monthFillSum.set(s.month, (monthFillSum.get(s.month) ?? 0) + f);
    monthFillCnt.set(s.month, (monthFillCnt.get(s.month) ?? 0) + 1);
  }
  const fillByMonth = [...monthFillSum.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, sum]) => {
      const [y, m] = bucket.split("-");
      return {
        label: `${MONTH_NAMES[Number(m) - 1]} ${y}`,
        value: Math.round(sum / (monthFillCnt.get(bucket) ?? 1)),
      };
    });

  // Remplissage moyen par structure : chaque occurrence apporte le remplissage de SA séance.
  const fillSum = new Map<string, number>();
  const fillCnt = new Map<string, number>();
  for (const b of occ) {
    if (!b.slot.slotDate) continue;
    const f = sessionFill.get(sessionKeyOf(b, ymd(b.slot.slotDate)));
    if (f == null) continue;
    const s = structOf(b);
    fillSum.set(s, (fillSum.get(s) ?? 0) + f);
    fillCnt.set(s, (fillCnt.get(s) ?? 0) + 1);
  }
  const fillByStructure = [...fillSum.entries()]
    .map(([label, sum]) => ({
      label: shortStructureLabel(label),
      value: Math.round(sum / (fillCnt.get(label) ?? 1)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Évolution mensuelle : nombre d'occurrences datées par mois.
  const byMonth = [...monthCount.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => {
      const [y, m] = bucket.split("-");
      return { label: `${MONTH_NAMES[Number(m) - 1]} ${y}`, value };
    });

  // Effectifs (enfants) par exercice — TOUT l'historique daté (occAll), filtre type.
  const exoMap = new Map<string, number>();
  for (const b of occAll) {
    if (!typePass(b) || !b.slot.slotDate) continue;
    const label = schoolYearLabel(b.slot.slotDate);
    if (!label) continue;
    exoMap.set(label, (exoMap.get(label) ?? 0) + b.enfants);
  }
  const effectifsByExercice = [...exoMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));

  // ── Prévu / réalisé : les stats comptent ce qui a été SAISI, sans blocage (validée ou
  // non — le verrou, c'est l'acte de pointage qui le porte). Population = séances passées
  // (date ≤ aujourd'hui) + séances pointées quelle que soit leur date (un pointage saisi
  // vaut constat que la séance a eu lieu).
  const pastOcc = occ.filter(
    (b) => b.slot.slotDate != null && (b.pointage != null || ymd(b.slot.slotDate) <= today),
  );
  const prevu = pastOcc.length;
  const presents = pastOcc.filter((b) => b.pointage === "present").length;
  const absents = pastOcc.filter((b) => b.pointage === "absent").length;
  const nonPointes = prevu - presents - absents;
  const tauxPresence =
    presents + absents > 0 ? Math.round((100 * presents) / (presents + absents)) : null;
  // Calculé indépendamment de tauxPresence (pas en 100 - tauxPresence) : évite un
  // arrondi couplé qui pourrait faire dévier légèrement les deux valeurs affichées.
  const tauxAbsence =
    presents + absents > 0 ? Math.round((100 * absents) / (presents + absents)) : null;
  const tauxRealisation = prevu > 0 ? Math.round((100 * presents) / prevu) : null;

  // Total RÉEL des occurrences avec thème (avant réduction au top 10) : sert de centre
  // d'anneau exact, comme distinctUsers pour le ring « Top structures ».
  const themedCount = [...themeMap.values()].reduce((s, v) => s + v, 0);

  return {
    total,
    distinctUsers,
    pending,
    enfants,
    accompagnants,
    recurringCount,
    uniqueCount,
    avgFill,
    prevu,
    presents,
    absents,
    nonPointes,
    tauxPresence,
    tauxAbsence,
    tauxRealisation,
    byDay,
    byMonth,
    fillByMonth,
    topStructures: topN(structMap, 10).map((r) => ({ ...r, label: shortStructureLabel(r.label) })),
    topNiveaux: topN(niveauMap, 10),
    topThemes: topN(themeMap, 10),
    themedCount,
    fillByStructure,
    effectifsByExercice,
  };
}
