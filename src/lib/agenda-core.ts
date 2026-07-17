// Socle PARTAGÉ des deux grilles agenda (admin `agenda-grid.tsx` et usager
// `user-agenda-grid.tsx`) : helpers PURS de dates, créneaux et layout, extraits
// à l'identique des deux copies locales (audit duplication 2026-06). Toute
// correction ici profite aux deux écrans — ne pas re-dupliquer dans les grilles.

import type { CSSProperties } from "react";
import { slotWeekTag } from "@/lib/iso-week";

// Parité A/B : convention unique de l'app (lib/iso-week) — ré-exportée pour que
// les grilles n'aient qu'un seul point d'import du socle.
export { slotWeekTag };

export const DAY_OFFSET: Record<string, number> = {
  lun: 0,
  mar: 1,
  mer: 2,
  jeu: 3,
  ven: 4,
  sam: 5,
  dim: 6,
};

export const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

// Index getUTCDay()/getDay() (0=dim..6=sam) → clé jour. Source unique côté serveur
// (stats, éditions, auto-validation) — évite de recopier ce tableau. NB : distinct de
// l'index ISO 1=lun..7=dim utilisé par la génération de miroirs (slots.ts).
export const ISO_DAY_KEYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const;

/**
 * Une réservation est-elle VERROUILLÉE pour la gestion (valider / déplacer / supprimer /
 * copier) ? Prédicat PUR partagé serveur (bookingLocked) ET client (lockedByPointage) —
 * l'appelant fournit `hasPointedChild` (miroir pointé) car sa source diffère (requête BDD
 * côté serveur, set précalculé côté client). Règles : un MIROIR (parentBookingId non null)
 * est immuable ; une résa POINTÉE l'est ; un PARENT récurrent à miroir pointé l'est. Le
 * pointage lui-même n'est PAS gouverné par ce verrou.
 */
export function isBookingLockedByPointage(
  bk: { pointage: string | null; parentBookingId: number | null; bookingType: string },
  hasPointedChild: boolean,
): boolean {
  if (bk.parentBookingId != null) return true;
  if (bk.pointage != null) return true;
  return bk.bookingType === "recurring" && hasPointedChild;
}

export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return x;
}

export function addDays(iso: string, n: number): Date {
  const x = new Date(`${iso}T00:00:00`);
  x.setDate(x.getDate() + n);
  return x;
}

export const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

// Clé jour (lun..dim) d'une date "YYYY-MM-DD" — pour projeter un créneau ponctuel
// daté sur la bonne colonne jour de l'agenda (legacy _agendaDayKeyFromYmd). Réutilise
// ISO_DAY_KEYS (même indexation getDay 0=dim) plutôt qu'une 2e copie du tableau.
export function dayKeyFromYmd(ymdStr: string): string {
  return ISO_DAY_KEYS[new Date(`${ymdStr}T00:00:00`).getDay()] ?? "";
}

// ─── Créneaux ────────────────────────────────────────────────────────────────

export type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  // Jour de la semaine du créneau récurrent (modèle « un slot = un jour »).
  slotDay: string | null;
  periodId: number | null;
  weeks: string | null;
  // « A une jauge » : occupation comptée en unités-jauge (enfants + adultes) si
  // vrai, en nombre de réservations sinon — propriété DU créneau (slots.jauge).
  jauge: boolean;
  // Renseigné uniquement pour les créneaux ponctuels projetés (slots virtuels).
  slotDate?: string | null;
};

// Créneau ponctuel (daté) tel que chargé pour l'agenda.
// parentSlotId non nul = créneau "miroir" (matérialisation d'un récurrent) ; null =
// ponctuel autonome (affiché en vert dans le legacy).
export type UniqueSlot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDate: string;
  parentSlotId: string | null;
  // « A une jauge » (cf. Slot.jauge ; les miroirs portent la valeur du parent).
  jauge: boolean;
  // Période du créneau (optionnel : fourni à l'agenda USAGER pour le contrôle
  // de disponibilité « Dispo » ; absent côté admin).
  periodId?: number | null;
};

// ── Réglages d'ouverture PAR EXERCICE (résolus côté serveur : surcharge ?? service) ──
// Portés par le payload des grilles : chaque exercice publie ses réglages effectifs,
// la grille les applique à l'exercice couvrant chaque jour affiché.
export type ExerciceOpening = {
  activeDays: string; // CSV « lun,mar,… »
  openOnHolidays: boolean;
  // Politique du SERVICE seul — la grille USAGER la combine (∧) avec le demandeur.
  openOnSchoolHolidays: boolean;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

/** Élément dont la plage [dateStart, dateEnd] couvre `d` (bornes "" = jamais). */
export function coveringForYmd<T extends { dateStart: string; dateEnd: string }>(
  items: T[],
  d: string,
): T | null {
  return items.find((e) => e.dateStart && e.dateEnd && e.dateStart <= d && d <= e.dateEnd) ?? null;
}

/** Ouverture « FERMÉ » : repli des dates couvertes par aucun exercice (le service
 * ne porte plus de réglages d'ouverture) — aucun jour actif, aucune plage. */
export const CLOSED_OPENING: ExerciceOpening = {
  activeDays: "",
  openOnHolidays: false,
  openOnSchoolHolidays: false,
  morningStart: "00:00",
  morningEnd: "00:00",
  afternoonStart: "00:00",
  afternoonEnd: "00:00",
};

export type Pointage = "present" | "absent" | null;

// Semaines où le créneau "tourne" (port de la colonne weeks). null / "" = toutes.
export function parseWeeks(weeks: string | null): ("A" | "B")[] {
  if (!weeks) return ["A", "B"];
  const set = new Set(
    weeks
      .split(",")
      .map((w) => w.trim().toUpperCase())
      .filter((w) => w === "A" || w === "B"),
  );
  return set.size ? (Array.from(set) as ("A" | "B")[]) : ["A", "B"];
}

// Modèle « un slot = un jour » : la capacité d'un jour n'existe que si c'est LE jour
// du créneau (slot.slotDay). Les slots ponctuels projetés portent leur slotDay = jour
// de leur date, ce qui les fait passer ici aussi.
export function dayCap(slot: Slot, dayKey: string): number | null {
  return slot.slotDay === dayKey ? slot.capacity : null;
}

export function toMinutes(t: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Couleurs de base des badges, reprises de `_badgeStyle(bk)` du legacy (app.js) :
// validé = fond vert clair + bordure accent ; en attente = fond orange clair +
// bordure orange. Le texte reste lisible via --badge-text (fallback inline).
// (Les deux grilles avaient divergé sur le fond « en attente » — harmonisé
// sur #ffe6a7, décision 2026-06.)
export function badgeStyle(validated: boolean): CSSProperties {
  return validated
    ? {
        background: "#c8e8b8",
        borderColor: "var(--accent)",
        color: "var(--badge-text, #1a1f2e)",
      }
    : {
        background: "#ffe6a7",
        borderColor: "rgba(232, 164, 90, .45)",
        color: "var(--badge-text, #1a1f2e)",
      };
}

// ─── Blocs & layout ──────────────────────────────────────────────────────────

// Bloc = UN créneau (slot) un jour donné, regroupant toutes ses réservations.
// Générique sur le type de réservation : les deux grilles ont des champs Booking
// différents (admin : tel/email ; usager : mine).
export type AgendaBlockBase<TBooking> = {
  slotId: string;
  dayKey: string;
  bookings: TBooking[];
  // Minutes brutes du créneau : top/height (px) sont dérivés AU RENDU via mapMinToY
  // (qui dépend du compactage pause/masquage des lignes vides, recalculé hors useMemo).
  startMin: number;
  endMin: number;
  leftPct: number;
  widthPct: number;
  used: number;
  capacity: number;
  full: boolean;
  // « A une jauge » du créneau : `used` est déjà compté selon cette règle
  // (unités-jauge si vrai, 1 par réservation sinon) ; sert aussi à l'affichage
  // (badge jauge éditable, barre de remplissage).
  jauge: boolean;
  // Créneau « journée entière » (sans horaire) : rendu dans la bande dédiée en
  // haut de l'agenda, pas sur la grille horaire (cf. legacy alldayBlocks).
  isAllDay: boolean;
};

// Port de `_agendaLayoutOverlaps` (app.js) : pour les créneaux d'une même colonne
// jour qui se chevauchent dans le temps, calcule le nombre de colonnes et l'index
// de chacun → permet de les juxtaposer horizontalement (sinon pleine largeur).
export type LayoutItem = { startMin: number; endMin: number; col: number; colCount: number };
export function layoutOverlaps(items: LayoutItem[]): void {
  if (!items.length) return;
  items.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  let cluster: LayoutItem[] = [];
  let clusterMaxEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((b) => b.col + 1));
    for (const b of cluster) b.colCount = n;
    cluster = [];
    clusterMaxEnd = Number.NEGATIVE_INFINITY;
  };
  for (const b of items) {
    if (b.startMin >= clusterMaxEnd) flush();
    const activeCols = new Set(cluster.filter((x) => x.endMin > b.startMin).map((x) => x.col));
    let col = 0;
    while (activeCols.has(col)) col++;
    b.col = col;
    cluster.push(b);
    clusterMaxEnd = Math.max(clusterMaxEnd, b.endMin);
  }
  flush();
}

// ─── Rendu / impression ──────────────────────────────────────────────────────

export const ROW_H = 56;

// ─── Géométrie de la grille semaine (axe horaire) ────────────────────────────
// Mutualisée entre la grille admin et la grille usager : à partir des bornes de
// la plage horaire, de la pause méridienne et — optionnellement — de l'ensemble
// des quarts d'heure à conserver (compactage « masquer les horaires vides »),
// produit la liste des quarts VISIBLES et les fonctions de mapping minute↔pixel.
// La logique de « ce qui est occupé » diffère entre les deux modes : chaque
// conteneur construit son propre `occupiedQ` et le passe ici (null = pas de
// compactage). Le reste (pause compactée à 30 min, mapping linéaire intra-quart)
// est identique partout. Port du legacy renderAgendaWeekly / mapMinToY.
export type GridGeometry = {
  /** Quarts d'heure visibles (minutes depuis minuit), dans l'ordre. */
  quarters: number[];
  /** Index d'un quart visible (minute → position dans `quarters`). */
  qIdx: Map<number, number>;
  /** Hauteur totale de la grille en pixels. */
  totalH: number;
  /** Minute réelle → y (px), linéaire intra-quart, gère la pause compactée. */
  mapMinToY: (min: number) => number;
  /** Inverse de mapMinToY pour le clic (y px → minute). */
  yToMin: (y: number) => number;
};

export function gridGeometry(args: {
  gridStartMin: number;
  gridEndMin: number;
  /** morningEnd en minutes (NaN accepté = pas de pause). */
  lunchStart: number;
  /** afternoonStart en minutes (NaN accepté = pas de pause). */
  lunchEnd: number;
  /** Quarts à conserver (compactage actif) ; null = tous les quarts visibles. */
  occupiedQ: Set<number> | null;
}): GridGeometry {
  const { gridStartMin, gridEndMin, lunchStart, lunchEnd, occupiedQ } = args;
  const QUARTER_H = ROW_H / 4; // px par tranche de 15 min
  const hasLunch =
    Number.isFinite(lunchStart) &&
    Number.isFinite(lunchEnd) &&
    lunchEnd > lunchStart &&
    lunchStart >= gridStartMin &&
    lunchEnd <= gridEndMin;
  // Pause > 30 min → on ne garde que 2 quarts visuels (les suivants sont sautés).
  const lunchSkipFrom = hasLunch && lunchEnd - lunchStart > 30 ? lunchStart + 30 : null;

  const quarters: number[] = [];
  for (let m = gridStartMin; m < gridEndMin; m += 15) {
    if (occupiedQ && !occupiedQ.has(m)) continue;
    if (lunchSkipFrom !== null && m >= lunchSkipFrom && m < lunchEnd) continue;
    quarters.push(m);
  }
  const qIdx = new Map<number, number>();
  quarters.forEach((m, i) => {
    qIdx.set(m, i);
  });
  const totalH = quarters.length * QUARTER_H;
  const mapMinToY = (min: number): number => {
    const q = Math.floor(min / 15) * 15;
    const offset = (min - q) / 15; // 0..1
    const idx = qIdx.get(q);
    if (idx !== undefined) return (idx + offset) * QUARTER_H;
    // Quart non visible (pause compactée) : collé au dernier quart visible amont.
    let prev = -1;
    for (const qv of quarters) {
      if (qv >= q) break;
      const i = qIdx.get(qv);
      if (i !== undefined) prev = i;
    }
    return (prev + 1) * QUARTER_H;
  };
  const yToMin = (y: number): number => {
    const idx = Math.floor(y / QUARTER_H);
    const clamped = Math.max(0, Math.min(quarters.length - 1, idx));
    const base = quarters[clamped] ?? gridStartMin;
    const offset = y - clamped * QUARTER_H; // px dans le quart
    return base + (offset / QUARTER_H) * 15;
  };
  return { quarters, qIdx, totalH, mapMinToY, yToMin };
}

// ════════════════════════════════════════════════════════════
//  Couche péri-grille PARTAGÉE (audit 2026-07-17) : dérivations pures communes aux
//  grilles admin et usager — ouvertures de la semaine, jours/bornes de grille, pause
//  méridienne, période couvrante, navigation hebdomadaire. Chaque fonction remplace
//  deux copies quasi identiques ; les hooks React associés vivent dans
//  components/agenda-hooks.ts.
// ════════════════════════════════════════════════════════════

/**
 * Ouvertures « de contexte » d'une semaine réelle : l'ouverture de l'exercice couvrant
 * CHAQUE jour de la semaine, dédupliquée — une semaine à cheval sur deux exercices
 * agrège les deux. (En Modèle de période, l'admin fournit directement l'ouverture de
 * l'exercice affiché, sans passer ici.)
 */
export function weekContextOpenings(
  anchorMonday: string,
  openingForYmd: (d: string) => ExerciceOpening,
): ExerciceOpening[] {
  const uniq = new Map<string, ExerciceOpening>();
  for (let i = 0; i < 7; i++) {
    const o = openingForYmd(ymd(addDays(anchorMonday, i)));
    uniq.set(
      `${o.activeDays}|${o.morningStart}|${o.morningEnd}|${o.afternoonStart}|${o.afternoonEnd}`,
      o,
    );
  }
  return [...uniq.values()];
}

/**
 * Colonnes (jours actifs, union du contexte) et bornes horaires de la grille :
 * amplitude des plages RÉELLEMENT ouvertes — une plage « fermée » (fin ≤ début,
 * p.ex. 00:00–00:00 pour « fermé l'après-midi ») est ignorée, sinon afternoonEnd
 * = 00:00 ramenait la fin de grille à minuit. Repli matin/après-midi standard
 * (9 h-18 h) si tout est fermé.
 */
export function gridDaysAndBounds(openings: ExerciceOpening[]): {
  days: string[];
  openRanges: [number, number][];
  startMin: number;
  endMin: number;
  baseFirst: number;
  baseLast: number;
} {
  const set = new Set<string>();
  for (const o of openings) {
    for (const d of o.activeDays.split(",")) {
      const t = d.trim();
      if (t) set.add(t);
    }
  }
  const days = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].filter((d) => set.has(d));
  const openRanges: [number, number][] = [];
  for (const o of openings) {
    for (const [s, e] of [
      [toMinutes(o.morningStart, 9 * 60), toMinutes(o.morningEnd, 12 * 60)],
      [toMinutes(o.afternoonStart, 14 * 60), toMinutes(o.afternoonEnd, 18 * 60)],
    ] as const) {
      if (e > s) openRanges.push([s, e]);
    }
  }
  const startMin = openRanges.length ? Math.min(...openRanges.map((r) => r[0])) : 9 * 60;
  const endMin = openRanges.length ? Math.max(...openRanges.map((r) => r[1])) : 18 * 60;
  return {
    days,
    openRanges,
    startMin,
    endMin,
    baseFirst: Math.floor(startMin / 60),
    baseLast: Math.ceil(endMin / 60),
  };
}

/**
 * Bornes de la pause méridienne : celle du PREMIER contexte qui en définit une (un
 * jour hors exercice — CLOSED_OPENING, ex. lundi 31 août avant un exercice démarrant
 * le 1er septembre — ne doit pas masquer la pause du reste de la semaine). hasLunch
 * exige la pause DANS les bornes visibles de la grille.
 */
export function lunchBounds(
  openings: ExerciceOpening[],
  gridStartMin: number,
  gridEndMin: number,
): { lunchStart: number; lunchEnd: number; hasLunch: boolean; lunchSkipFrom: number | null } {
  const lunchOpening =
    openings.find((o) => {
      const s = toMinutes(o.morningEnd, Number.NaN);
      const e = toMinutes(o.afternoonStart, Number.NaN);
      return Number.isFinite(s) && Number.isFinite(e) && e > s;
    }) ?? openings[0];
  const lunchStart = toMinutes(lunchOpening?.morningEnd ?? "", Number.NaN);
  const lunchEnd = toMinutes(lunchOpening?.afternoonStart ?? "", Number.NaN);
  const hasLunch =
    Number.isFinite(lunchStart) &&
    Number.isFinite(lunchEnd) &&
    lunchEnd > lunchStart &&
    lunchStart >= gridStartMin &&
    lunchEnd <= gridEndMin;
  const lunchSkipFrom = hasLunch && lunchEnd - lunchStart > 30 ? lunchStart + 30 : null;
  return { lunchStart, lunchEnd, hasLunch, lunchSkipFrom };
}

/**
 * Période « couvrant » la semaine réelle : priorité à la période VERROUILLÉE
 * (rwPeriodId) tant qu'elle intersecte la semaine — sinon dérivation depuis l'ancre
 * (lundi puis mercredi, pour les périodes commençant en milieu de semaine).
 * Cf. legacy l.6469-6480 ; le verrou lui-même est posé par useCoveringPeriodLock.
 */
export function deriveCoveringPeriod<
  P extends { id: number; dateStart: string | null; dateEnd: string | null },
>(
  periods: P[],
  mondayStr: string | null,
  rwPeriodId: number | null,
): {
  sundayStr: string | null;
  periodCoveringDate: (d: string) => P | null;
  coveringPeriod: P | null;
} {
  const sundayStr = mondayStr ? ymd(addDays(mondayStr, 6)) : null;
  const periodCoveringDate = (d: string) =>
    periods.find((p) => p.dateStart && p.dateEnd && p.dateStart <= d && p.dateEnd >= d) ?? null;
  const lockedPeriod =
    rwPeriodId != null
      ? (periods.find(
          (p) =>
            p.id === rwPeriodId &&
            mondayStr != null &&
            sundayStr != null &&
            p.dateStart != null &&
            p.dateEnd != null &&
            p.dateStart <= sundayStr &&
            p.dateEnd >= mondayStr,
        ) ?? null)
      : null;
  const coveringPeriod =
    mondayStr && sundayStr
      ? (lockedPeriod ??
        periodCoveringDate(mondayStr) ??
        periodCoveringDate(ymd(addDays(mondayStr, 3))))
      : null;
  return { sundayStr, periodCoveringDate, coveringPeriod };
}

/**
 * Navigation hebdomadaire ◀/▶ : bornée aux dates de la période couvrante ; en mode
 * « masquer les semaines vides » (hideEmpty), désactive une direction sans semaine
 * pleine et fait sauter shiftTarget aux semaines AYANT du contenu (port legacy
 * shiftAgendaWeek). `weekHas` définit le contenu : réservations côté admin, créneaux
 * côté usager. shiftTarget renvoie le nouveau lundi, ou null si le saut sort de la
 * période (l'appelant n'ancre alors rien). Balaie jusqu'à 260 semaines : à appeler
 * sous useMemo (cf. les deux grilles).
 */
export function makeWeekNavigation(args: {
  mondayStr: string | null;
  coveringPeriod: { dateStart?: string | null; dateEnd?: string | null } | null;
  hideEmpty: boolean;
  weekHas: (monday: string) => boolean;
}): {
  canWeekPrev: boolean;
  canWeekNext: boolean;
  shiftTarget: (deltaWeeks: number) => string | null;
} {
  const { mondayStr, coveringPeriod, hideEmpty, weekHas } = args;
  // Existe-t-il une semaine pleine au-delà de `monday` dans la direction donnée,
  // sans sortir de la période active ?
  const hasWeekBeyond = (monday: string, dir: 1 | -1): boolean => {
    const startB = coveringPeriod?.dateStart;
    const endB = coveringPeriod?.dateEnd;
    let cur = ymd(addDays(monday, dir * 7));
    for (let i = 0; i < 260; i++) {
      const sunday = ymd(addDays(cur, 6));
      if (endB && cur > endB) break;
      if (startB && sunday < startB) break;
      if (weekHas(cur)) return true;
      cur = ymd(addDays(cur, dir * 7));
    }
    return false;
  };
  const canWeekPrev = mondayStr
    ? (coveringPeriod?.dateStart
        ? ymd(addDays(mondayStr, -1)) >= coveringPeriod.dateStart
        : true) &&
      (!hideEmpty || hasWeekBeyond(mondayStr, -1))
    : false;
  const canWeekNext = mondayStr
    ? (coveringPeriod?.dateEnd ? ymd(addDays(mondayStr, 7)) <= coveringPeriod.dateEnd : true) &&
      (!hideEmpty || hasWeekBeyond(mondayStr, 1))
    : false;
  const shiftTarget = (deltaWeeks: number): string | null => {
    if (!mondayStr) return null;
    let newAnchor = ymd(addDays(mondayStr, deltaWeeks * 7));
    if (hideEmpty && deltaWeeks !== 0) {
      const step = deltaWeeks > 0 ? 7 : -7;
      const MAX_ITER = 260;
      let iter = 0;
      while (iter++ < MAX_ITER) {
        if (weekHas(newAnchor)) break;
        if (!hasWeekBeyond(newAnchor, deltaWeeks > 0 ? 1 : -1)) break;
        newAnchor = ymd(addDays(newAnchor, step));
      }
    }
    // Clamp à la période active : si le saut sort de la période, on annule.
    if (coveringPeriod?.dateStart && coveringPeriod.dateEnd) {
      const newSunday = ymd(addDays(newAnchor, 6));
      if (newAnchor > coveringPeriod.dateEnd || newSunday < coveringPeriod.dateStart) return null;
    }
    return newAnchor;
  };
  return { canWeekPrev, canWeekNext, shiftTarget };
}
