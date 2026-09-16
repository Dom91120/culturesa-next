import { DAY_NAMES, ISO_DAY_KEYS } from "@/lib/agenda-core";
import { todayParisISO } from "@/lib/booking-delay";
import { monthShortLabel } from "@/lib/format";
import { gaugeUnits } from "@/lib/gauge";
import { schoolYearLabel } from "@/lib/school-year";
import { computeSlotStats, type SlotStats } from "@/lib/slot-stats";
import { computeWaitlistStats, type WaitlistStats } from "@/lib/waiting-list-stats";
import { DAYS } from "@/schemas/config";
import { prisma } from "@/server/db";

// =====================================================================================
// Statistiques d'un service. Agrégation 100 % serveur, sans dépendance de graphes :
// la page rend des barres/anneaux CSS. TOUT est compté sur les OCCURRENCES DATÉES
// (« séances ») : ponctuels autonomes + miroirs des récurrentes — un récurrent hebdo
// compte donc une fois PAR occurrence. `occAll` = tout l'historique daté du service ;
// `occ` = filtré au type et à la plage de dates. Le pointage (prévu/réalisé) vit sur ces
// mêmes occurrences (séances passées, plus toute séance pointée — validée ou non).
//
// EXCEPTION (décision produit 2026-07-25, étendue le 2026-09-16) : les EFFECTIFS (enfants,
// accompagnants, effectifs par exercice, et les RÉPARTITIONS par jour / structure / niveau
// / thème) sont des personnes, pas des volumes de séances. Sans identité des enfants en
// base, on les estime par la « règle du max » : pour chaque usager ayant réservé dans la
// population (ou dans la part de la répartition), on retient l'effectif de sa réservation
// la plus nombreuse (un récurrent ou des re-réservations du même usager ne comptent qu'une
// fois). Le cumul par séance reste exposé (enfantsCumul → sous-texte de la tuile
// « Fréquentation enfants »). Le comptage mensuel et le remplissage restent en séances.
// =====================================================================================

export type StatsType = "all" | "rec" | "uniq";

export type StatsFilters = {
  type: StatsType;
  dateFrom: string | null; // YYYY-MM-DD inclus
  dateTo: string | null; // YYYY-MM-DD inclus
};

export type LabeledCount = { label: string; value: number; color?: string };

type ServiceStats = {
  total: number;
  distinctUsers: number;
  pending: number;
  // Effectifs ESTIMÉS (règle du max par usager, cf. en-tête) — « chaque enfant/
  // accompagnant compté une fois », même en récurrent ou multi-réservations.
  enfants: number;
  accompagnants: number;
  // Cumul par séance (ancienne sémantique volume) : un récurrent compte ses enfants à
  // chaque occurrence — tuile « Fréquentation enfants » + moyenne par séance.
  enfantsCumul: number;
  // Répartition par type sur les OCCURRENCES — anneau « Type de réservation » (miroir =
  // récurrente, ponctuel autonome = ponctuelle).
  recurringCount: number;
  uniqueCount: number;
  // Remplissage moyen GLOBAL (%, unités de jauge) sur TOUTE L'OFFRE : chaque séance
  // datée proposée sur la plage compte, une séance sans réservation vaut 0 % (décision
  // Dom 2026-09-13 — « l'offre est-elle utilisée ? »). null sans séance proposée.
  avgFill: number | null;
  // Même moyenne restreinte aux séances RÉSERVÉES (« quand une séance a lieu, est-elle
  // pleine ? ») — ancienne sémantique, affichée en sous-texte. null si aucune.
  avgFillReserves: number | null;
  // Prévu / réalisé (séances datées passées, validées)
  prevu: number;
  presents: number;
  absents: number;
  nonPointes: number;
  // Absences PRÉVENUES à l'avance (cf. services/booking-absence) : toutes séances de la
  // population (à venir comprises) pour la tuile ; et, parmi les absents pointés, celles
  // qui avaient été signalées — pour distinguer absence prévenue / non prévenue.
  absencesPrevenues: number;
  absentsPrevenus: number;
  tauxPresence: number | null; // présents / (présents + absents)
  tauxAbsence: number | null; // absents / (présents + absents)
  tauxRealisation: number | null; // présents / prévu
  // Graphes. byDay / topStructures / topNiveaux / topThemes = ENFANTS DISTINCTS par part
  // (règle du max par usager à l'intérieur de la part) ; byMonth = séances.
  byDay: LabeledCount[];
  byMonth: LabeledCount[];
  // Remplissage moyen (%, unités de jauge) par mois — même règle que avgFill (toute
  // l'offre, séances vides à 0 %) : évolution de l'usage au fil de l'exercice.
  fillByMonth: LabeledCount[];
  topStructures: LabeledCount[];
  topNiveaux: LabeledCount[];
  // Répartition par thème (texte saisi/choisi par l'usager) — occurrences ayant un thème
  // non vide. topThemes = top 10 (comme topStructures/topNiveaux, pas de normalisation de
  // casse en mode « libre ») ; themedCount = enfants distincts parmi TOUTES les séances
  // thémées (pas seulement le top 10) pour un centre d'anneau exact.
  topThemes: LabeledCount[];
  themedCount: number;
  // Effectifs (enfants) par exercice — TOUS exercices (ignore la plage de dates), pour
  // suivre l'évolution d'une année scolaire à l'autre. Respecte le filtre de type.
  // Deux lectures par exercice : total = cumul des séances (volume), distincts = règle
  // du max par usager appliquée à l'intérieur de l'exercice.
  effectifsByExercice: { label: string; total: number; distincts: number }[];
  // Liste d'attente : qui n'a pas trouvé de place (historique liste_attente_historique +
  // inscriptions ouvertes), filtre de dates sur la date d'INSCRIPTION, indépendant du
  // type — cf. lib/waiting-list-stats. null si le service n'a jamais eu d'inscription.
  waitlist: WaitlistStats | null;
  // Créneaux (l'OFFRE, par opposition aux séances réservées) : créneaux proposés sur la
  // plage — un RÉCURRENT compte UNE fois (comme la carte « Créneaux ouverts » des
  // Éditions), un ponctuel une fois —, réservés / libres, taux, par mois — cf.
  // lib/slot-stats. L'écran ne montre ce volet que si créneaux ≠ séances.
  slots: SlotStats;
};

/** Date UTC → 'YYYY-MM-DD'. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Libellés de jours : source unique = DAY_NAMES (lib/agenda-core, pur — audit D2).
// Libellés de mois : le NUMÉRO du mois (1..12) — demande Dom 2026-07-25 (colonnes
// étroites des courbes mensuelles) ; l'année reste lisible via le filtre d'exercice.
// Mois en lettres abrégées (Dom 2026-09-15), comme le tableau « Créneaux par mois ».
const monthLabel = (bucket: string): string => monthShortLabel(bucket);

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
      absencePrevenueAt: true,
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
      // Snapshot fiche usager posé À LA CRÉATION de la réservation (cf.
      // bookingUserSnapshot) : la répartition structures/niveaux ne bouge plus quand
      // la fiche change (Mon compte, admin) après coup.
      structureLabel: true,
      demandeurLabel: true,
      niveauLabel: true,
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
  // Repli « structures » : catégorie (demandeur) si l'usager n'avait pas de structure
  // à la réservation — mêmes replis qu'avant, mais sur le snapshot.
  const structOf = (b: (typeof occAll)[number]): string =>
    b.structureLabel || b.demandeurLabel || "(sans structure)";
  const sessionKeyOf = (b: (typeof occAll)[number], dateStr: string): string =>
    `${b.slot.parentSlotId ?? b.slot.id}|${dateStr}`;

  // ── Offre : créneaux DATÉS du service sur la plage ───────────────────────────
  // Miroirs des récurrents + ponctuels : ils existent en base indépendamment des
  // réservations (matérialisés à la création du récurrent / de la période). Sert au
  // volet créneaux ET au remplissage moyen (séances vides à 0 %). Filtre de type
  // appliqué au CRÉNEAU (miroir = récurrent).
  const slotRows = await prisma.slot.findMany({
    where: {
      serviceId,
      slotDate: {
        not: null,
        ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
        ...(dateTo ? { lte: new Date(`${dateTo}T00:00:00.000Z`) } : {}),
      },
    },
    select: { id: true, slotDate: true, parentSlotId: true, capacity: true },
  });
  const slotTypePass = (s: { parentSlotId: string | null }): boolean =>
    type === "rec" ? s.parentSlotId != null : type === "uniq" ? s.parentSlotId == null : true;
  // Séances PROPOSÉES (même clé que sessionAgg : créneau récurrent parent ?? créneau,
  // + date) → capacité et mois, pour compter les séances vides à 0 %.
  const offerSessions = new Map<string, { cap: number; month: string }>();
  for (const s of slotRows) {
    if (!s.slotDate || !slotTypePass(s)) continue;
    const d = ymd(s.slotDate);
    offerSessions.set(`${s.parentSlotId ?? s.id}|${d}`, {
      cap: s.capacity ?? serviceCapacity,
      month: d.slice(0, 7),
    });
  }

  const total = occ.length;
  const distinctUsers = new Set(occ.map((b) => b.userId)).size;
  const pending = occ.filter((b) => !b.validated).length;
  // Règle du max par usager (cf. en-tête) : max indépendant par métrique — pour les
  // accompagnants aussi, on retient la réservation la plus accompagnée de l'usager.
  const sumOfMaxByUser = (
    pop: typeof occAll,
    pick: (b: (typeof occAll)[number]) => number,
  ): number => {
    const m = new Map<string, number>();
    for (const b of pop) m.set(b.userId, Math.max(m.get(b.userId) ?? 0, pick(b)));
    return [...m.values()].reduce((s, v) => s + v, 0);
  };
  const enfants = sumOfMaxByUser(occ, (b) => b.enfants);
  const accompagnants = sumOfMaxByUser(occ, (b) => b.accompagnants);
  const enfantsCumul = occ.reduce((s, b) => s + b.enfants, 0);
  const recurringCount = occ.filter((b) => b.parentBookingId != null).length;
  const uniqueCount = occ.filter((b) => b.parentBookingId == null).length;

  // Répartitions (jour / structures / niveaux / thèmes) en ENFANTS DISTINCTS (Dom
  // 2026-09-16) : dans chaque groupe, règle du max par usager — un récurrent de 14 séances
  // à 3 enfants pèse 3 dans « Lundi » et dans sa structure, pas 14. Le comptage mensuel et
  // les agrégats par SÉANCE (= créneau récurrent parent ?? créneau, + date, pour le
  // remplissage) restent en séances.
  const dayGroups = new Map<string, Map<string, number>>();
  const structGroups = new Map<string, Map<string, number>>();
  const niveauGroups = new Map<string, Map<string, number>>();
  const themeGroups = new Map<string, Map<string, number>>();
  const addMax = (
    groups: Map<string, Map<string, number>>,
    key: string,
    b: (typeof occ)[number],
  ) => {
    const g = groups.get(key) ?? new Map<string, number>();
    g.set(b.userId, Math.max(g.get(b.userId) ?? 0, b.enfants));
    groups.set(key, g);
  };
  const sumGroup = (g: Map<string, number>) => [...g.values()].reduce((s, v) => s + v, 0);
  const groupsToMap = (groups: Map<string, Map<string, number>>) =>
    new Map([...groups].map(([k, g]) => [k, sumGroup(g)]));
  const monthCount = new Map<string, number>();
  const sessionAgg = new Map<string, { occ: number; cap: number; month: string }>();
  for (const b of occ) {
    if (!b.slot.slotDate) continue;
    const dateStr = ymd(b.slot.slotDate);
    const dk = dayKeyOf(b.slot.slotDay, b.slot.slotDate);
    if (dk) addMax(dayGroups, dk, b);
    addMax(structGroups, structOf(b), b);
    addMax(niveauGroups, b.niveauLabel.trim() || "(aucun)", b);
    // Thème : seules les occurrences ayant EFFECTIVEMENT un thème saisi comptent (pas de
    // catégorie "(sans thème)" — sur un service sans thèmes, ça noierait le panneau).
    const theme = b.themeLabel?.trim();
    if (theme) addMax(themeGroups, theme, b);
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

  const dayMap = groupsToMap(dayGroups);
  const structMap = groupsToMap(structGroups);
  const niveauMap = groupsToMap(niveauGroups);
  const themeMap = groupsToMap(themeGroups);
  const byDay = DAYS.filter((d) => dayMap.has(d)).map((d) => ({
    label: DAY_NAMES[d],
    value: dayMap.get(d) ?? 0,
  }));

  // Remplissage % par SÉANCE : min(100, occupation jauge / capacité).
  const sessionFill = new Map<string, number>();
  for (const [k, s] of sessionAgg) {
    if (s.cap > 0) sessionFill.set(k, Math.min(100, (100 * s.occ) / s.cap));
  }

  // Remplissage moyen sur les séances RÉSERVÉES (ancienne sémantique, sous-texte).
  let fillTotR = 0;
  let fillNR = 0;
  for (const f of sessionFill.values()) {
    fillTotR += f;
    fillNR += 1;
  }
  const avgFillReserves = fillNR > 0 ? Math.round(fillTotR / fillNR) : null;

  // Remplissage moyen sur TOUTE L'OFFRE : union des séances proposées (vides → 0 %) et
  // des séances réservées (une réservation posée hors de l'offre filtrée — ponctuelle
  // sur un miroir en filtre « ponctuelles » — reste comptée). Capacité nulle ignorée,
  // comme pour les séances réservées.
  const allSessions = new Map<string, { fill: number; month: string }>();
  for (const [k, o] of offerSessions) {
    if (o.cap > 0) allSessions.set(k, { fill: sessionFill.get(k) ?? 0, month: o.month });
  }
  for (const [k, s] of sessionAgg) {
    const f = sessionFill.get(k);
    if (f != null && !allSessions.has(k)) allSessions.set(k, { fill: f, month: s.month });
  }
  let fillTotG = 0;
  for (const s of allSessions.values()) fillTotG += s.fill;
  const avgFill = allSessions.size > 0 ? Math.round(fillTotG / allSessions.size) : null;

  // Remplissage moyen par mois : même règle (toute l'offre du mois, vides à 0 %).
  const monthFillSum = new Map<string, number>();
  const monthFillCnt = new Map<string, number>();
  for (const s of allSessions.values()) {
    monthFillSum.set(s.month, (monthFillSum.get(s.month) ?? 0) + s.fill);
    monthFillCnt.set(s.month, (monthFillCnt.get(s.month) ?? 0) + 1);
  }
  const fillByMonth = [...monthFillSum.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, sum]) => ({
      label: monthLabel(bucket),
      value: Math.round(sum / (monthFillCnt.get(bucket) ?? 1)),
    }));

  // Évolution mensuelle : nombre d'occurrences datées par mois.
  const byMonth = [...monthCount.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, value]) => ({ label: monthLabel(bucket), value }));

  // Effectifs (enfants) par exercice — TOUT l'historique daté (occAll), filtre type.
  // « total » = cumul des séances ; « distincts » = règle du max par usager, appliquée
  // À L'INTÉRIEUR de chaque exercice (un usager présent sur deux années scolaires compte
  // dans chacune, avec son max de l'année).
  const exoOcc = new Map<string, typeof occAll>();
  for (const b of occAll) {
    if (!typePass(b) || !b.slot.slotDate) continue;
    const label = schoolYearLabel(b.slot.slotDate);
    if (!label) continue;
    exoOcc.set(label, [...(exoOcc.get(label) ?? []), b]);
  }
  const effectifsByExercice = [...exoOcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, pop]) => ({
      label,
      total: pop.reduce((s, b) => s + b.enfants, 0),
      distincts: sumOfMaxByUser(pop, (b) => b.enfants),
    }));

  // ── Prévu / réalisé : les stats comptent ce qui a été SAISI, validée ou non (le verrou,
  // c'est l'acte de pointage qui le porte). Population = séances passées, jour d'aujourd'hui
  // compris — le pointage est refusé sur une séance future (setBookingPointageAction), la
  // clause « ou pointées » d'origine (2026-07-14) ne visait plus rien (Dom 2026-09-15).
  const pastOcc = occ.filter((b) => b.slot.slotDate != null && ymd(b.slot.slotDate) <= today);
  const prevu = pastOcc.length;
  const presents = pastOcc.filter((b) => b.pointage === "present").length;
  const absents = pastOcc.filter((b) => b.pointage === "absent").length;
  const nonPointes = prevu - presents - absents;
  const absencesPrevenues = occ.filter((b) => b.absencePrevenueAt != null).length;
  const absentsPrevenus = pastOcc.filter(
    (b) => b.pointage === "absent" && b.absencePrevenueAt != null,
  ).length;
  const tauxPresence =
    presents + absents > 0 ? Math.round((100 * presents) / (presents + absents)) : null;
  // Calculé indépendamment de tauxPresence (pas en 100 - tauxPresence) : évite un
  // arrondi couplé qui pourrait faire dévier légèrement les deux valeurs affichées.
  const tauxAbsence =
    presents + absents > 0 ? Math.round((100 * absents) / (presents + absents)) : null;
  const tauxRealisation = prevu > 0 ? Math.round((100 * presents) / prevu) : null;

  // Total RÉEL des occurrences avec thème (avant réduction au top 10) : sert de centre
  // d'anneau exact, comme distinctUsers pour le ring « Top structures ».
  // Centre de l'anneau des thèmes : enfants distincts parmi les séances THÉMÉES (un même
  // inscrit sur deux thèmes ne compte qu'une fois — la somme des parts le compterait deux fois).
  const themedCount = sumOfMaxByUser(
    occ.filter((b) => b.slot.slotDate && b.themeLabel?.trim()),
    (b) => b.enfants,
  );

  // ── Créneaux (offre) ─────────────────────────────────────────────────────────
  // Sur `slotRows` (cf. plus haut). « Réservé » = porte au moins une séance, quel que
  // soit le type de la réservation (une ponctuelle posée sur un miroir occupe bien le
  // créneau) ; le filtre de type s'applique au CRÉNEAU dans computeSlotStats.
  const seancesBySlot = new Map<string, number>();
  for (const b of occAll) {
    if (b.slot.slotDate == null || !inRange(ymd(b.slot.slotDate), dateFrom, dateTo)) continue;
    seancesBySlot.set(b.slot.id, (seancesBySlot.get(b.slot.id) ?? 0) + 1);
  }
  const slots = computeSlotStats(
    slotRows.flatMap((s) =>
      s.slotDate ? [{ id: s.id, date: ymd(s.slotDate), parentSlotId: s.parentSlotId }] : [],
    ),
    seancesBySlot,
    { type, dateFrom, dateTo, today },
  );

  // ── Liste d'attente ───────────────────────────────────────────────────────────
  const [wlLogs, wlLive] = await Promise.all([
    prisma.waitingListLog.findMany({
      where: { serviceId },
      select: {
        inscritAt: true,
        clotureAt: true,
        issue: true,
        demandeurLabel: true,
        structureLabel: true,
      },
    }),
    prisma.waitingListEntry.findMany({
      where: { serviceId },
      select: {
        createdAt: true,
        user: {
          select: {
            demandeur: { select: { label: true } },
            structure: { select: { label: true } },
          },
        },
      },
    }),
  ]);
  const waitlist =
    wlLogs.length + wlLive.length > 0
      ? computeWaitlistStats(
          wlLogs.map((r) => ({
            inscritAt: r.inscritAt.toISOString(),
            clotureAt: r.clotureAt.toISOString(),
            issue: r.issue,
            demandeurLabel: r.demandeurLabel,
            structureLabel: shortStructureLabel(r.structureLabel),
          })),
          wlLive.map((r) => ({
            inscritAt: r.createdAt.toISOString(),
            demandeurLabel: r.user.demandeur?.label ?? "",
            structureLabel: shortStructureLabel(r.user.structure?.label ?? ""),
          })),
          { dateFrom, dateTo, nowIso: new Date().toISOString() },
        )
      : null;

  return {
    total,
    distinctUsers,
    pending,
    enfants,
    accompagnants,
    enfantsCumul,
    recurringCount,
    uniqueCount,
    avgFill,
    avgFillReserves,
    prevu,
    presents,
    absents,
    nonPointes,
    absencesPrevenues,
    absentsPrevenus,
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
    effectifsByExercice,
    waitlist,
    slots,
  };
}
