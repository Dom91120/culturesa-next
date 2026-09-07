// =====================================================================================
// Statistiques de la LISTE D'ATTENTE d'un service (fonctions pures, testées) : à partir de
// l'historique des inscriptions clôturées (liste_attente_historique) et des inscriptions
// encore ouvertes (liste_attente). Répond à « quels demandeurs n'ont pas trouvé de place ? »
// (Dom 2026-09-06). Le filtre de dates porte sur la DATE D'INSCRIPTION.
// « Sans place » = inscriptions ÉCHUES (périodes souhaitées terminées, clôture
// automatique) + retraits sans réservation : ce compteur ne prend son sens qu'en FIN de
// période ou d'exercice, une fois les inscriptions échues (Dom 2026-09-07).
// =====================================================================================

export type WaitlistOutcome =
  | "AUTO_BOOKED"
  | "BOOKED"
  | "LEFT"
  | "REMOVED"
  | "EXPIRED"
  | "ANONYMIZED";

/** Ligne d'historique (entrée clôturée). Dates ISO. */
export type WaitlistLogRow = {
  inscritAt: string;
  clotureAt: string;
  issue: WaitlistOutcome;
  demandeurLabel: string;
  structureLabel: string;
};

/** Inscription encore ouverte. */
export type WaitlistLiveRow = { inscritAt: string; demandeurLabel: string; structureLabel: string };

export type Labeled = { label: string; value: number };

export type WaitlistStats = {
  // Inscrits encore en attente (toutes dates : c'est l'état du jour) + ancienneté moyenne (j).
  waitingNow: number;
  waitingAvgDays: number | null;
  // Sur la plage (date d'inscription) : sans place (échues + retraits sans réservation),
  // placés (inscription automatique ou réservation obtenue) et délai moyen
  // inscription → réservation (j).
  noPlace: number;
  placed: number;
  placedAvgDays: number | null;
  // Anneau « issue des inscriptions » sur la plage (entrées ouvertes comprises) : les
  // sans-place y sont REGROUPÉS ; le détail (échues / retraits) est dans noPlaceDetail.
  outcomes: Labeled[];
  noPlaceDetail: Labeled[];
  // Sans place : répartition par catégorie (demandeur) et par structure.
  noPlaceByDemandeur: Labeled[];
  noPlaceByStructure: Labeled[];
  // Inscriptions par mois (libellé = numéro du mois, comme les autres courbes).
  byMonth: Labeled[];
};

export const OUTCOME_LABELS: Record<WaitlistOutcome | "WAITING" | "NO_PLACE", string> = {
  AUTO_BOOKED: "Inscrits automatiquement",
  BOOKED: "Ont obtenu une réservation",
  EXPIRED: "Périodes échues sans place",
  LEFT: "Retirés par l'usager",
  REMOVED: "Retirés par le service",
  ANONYMIZED: "Comptes anonymisés",
  WAITING: "Toujours en attente",
  NO_PLACE: "Sans place",
};

const DAY_MS = 86_400_000;

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

function inRange(d: string, from: string | null, to: string | null): boolean {
  return (!from || d >= from) && (!to || d <= to);
}

function avgDays(pairs: [string, string][]): number | null {
  if (pairs.length === 0) return null;
  const total = pairs.reduce(
    (s, [a, b]) => s + Math.max(0, new Date(b).getTime() - new Date(a).getTime()) / DAY_MS,
    0,
  );
  return Math.round((total / pairs.length) * 10) / 10;
}

function topN(map: Map<string, number>, n: number): Labeled[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

const isNoPlace = (o: WaitlistOutcome): boolean =>
  o === "EXPIRED" || o === "LEFT" || o === "REMOVED";
const isPlaced = (o: WaitlistOutcome): boolean => o === "AUTO_BOOKED" || o === "BOOKED";

export function computeWaitlistStats(
  logs: WaitlistLogRow[],
  live: WaitlistLiveRow[],
  opts: { dateFrom: string | null; dateTo: string | null; nowIso: string },
): WaitlistStats {
  const { dateFrom, dateTo, nowIso } = opts;
  const inLogs = logs.filter((r) => inRange(ymd(r.inscritAt), dateFrom, dateTo));
  const inLive = live.filter((r) => inRange(ymd(r.inscritAt), dateFrom, dateTo));

  const noPlaceRows = inLogs.filter((r) => isNoPlace(r.issue));
  const placedRows = inLogs.filter((r) => isPlaced(r.issue));

  const counts = new Map<WaitlistOutcome | "WAITING" | "NO_PLACE", number>();
  for (const r of inLogs) {
    const k = isNoPlace(r.issue) ? "NO_PLACE" : r.issue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (isNoPlace(r.issue)) counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
  }
  if (inLive.length > 0) counts.set("WAITING", inLive.length);
  const labeled = (keys: (WaitlistOutcome | "WAITING" | "NO_PLACE")[]): Labeled[] =>
    keys
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .map((k) => ({ label: OUTCOME_LABELS[k], value: counts.get(k) ?? 0 }));
  const outcomes = labeled(["AUTO_BOOKED", "BOOKED", "NO_PLACE", "ANONYMIZED", "WAITING"]);
  const noPlaceDetail = labeled(["EXPIRED", "LEFT", "REMOVED"]);

  const byDem = new Map<string, number>();
  const byStruct = new Map<string, number>();
  for (const r of noPlaceRows) {
    const dem = r.demandeurLabel || "(sans catégorie)";
    const st = r.structureLabel || r.demandeurLabel || "(sans structure)";
    byDem.set(dem, (byDem.get(dem) ?? 0) + 1);
    byStruct.set(st, (byStruct.get(st) ?? 0) + 1);
  }

  const months = new Map<string, number>();
  for (const r of [...inLogs, ...inLive]) {
    const m = ymd(r.inscritAt).slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + 1);
  }
  const byMonth = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, value]) => ({ label: String(Number(m.slice(5, 7))), value }));

  return {
    waitingNow: live.length,
    waitingAvgDays: avgDays(live.map((r) => [r.inscritAt, nowIso])),
    noPlace: noPlaceRows.length,
    placed: placedRows.length,
    placedAvgDays: avgDays(placedRows.map((r) => [r.inscritAt, r.clotureAt])),
    outcomes,
    noPlaceDetail,
    noPlaceByDemandeur: topN(byDem, 10),
    noPlaceByStructure: topN(byStruct, 10),
    byMonth,
  };
}
