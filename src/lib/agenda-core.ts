// Socle PARTAGÉ des deux grilles agenda (admin `agenda-grid.tsx` et usager
// `user-agenda-grid.tsx`) : helpers PURS de dates, créneaux et layout, extraits
// à l'identique des deux copies locales (audit duplication 2026-06). Toute
// correction ici profite aux deux écrans — ne pas re-dupliquer dans les grilles.

import type { CSSProperties } from "react";
import { isFrenchHoliday } from "@/lib/french-holidays";
import { gaugeUnits } from "@/lib/gauge";
import { slotWeekTag } from "@/lib/iso-week";
import { isInSchoolHolidayRange } from "@/lib/school-holidays";

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
  // Lot « multi » : identifiant partagé par les créneaux d'un même geste de création
  // répliquée (null hors multi). Permet « supprimer / modifier toute la série ».
  batchId: string | null;
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
 * Prédicats de fermeture PAR JOUR de la semaine réelle : jour inactif de l'exercice
 * couvrant la date, hors période couvrante, férié quand l'exercice ferme les fériés,
 * vacances scolaires quand il ferme les vacances. `active` = false (admin en Modèle
 * de période) → tout ouvert. `outOfPeriodCls` (classe de grisage) est UNIFIÉE
 * (2026-07-17) : férié OU vacances → is-holiday, hors période → is-out-of-period —
 * les deux classes partagent de toute façon la même règle CSS (hachis subtil,
 * app-legacy.css). À appeler sous useMemo : les fonctions renvoyées doivent rester
 * stables entre rendus (mémo des blocs par jour).
 */
export function makeDayClosure(args: {
  active: boolean;
  mondayStr: string | null;
  coveringPeriod: { dateStart?: string | null; dateEnd?: string | null } | null;
  openingForYmd: (d: string) => ExerciceOpening;
  schoolHolidays: { dateStart: string; dateEnd: string }[];
}): {
  isDayDisabled: (dayKey: string) => boolean;
  isHolidayDay: (dayKey: string) => boolean;
  isSchoolHolidayDay: (dayKey: string) => boolean;
  outOfPeriodCls: (dayKey: string) => string;
} {
  const { active, mondayStr, coveringPeriod, openingForYmd, schoolHolidays } = args;
  const isDayDisabled = (dayKey: string): boolean => {
    if (!active || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    // Réglages de l'exercice couvrant CE jour (les colonnes étant l'union des
    // jours actifs, un jour inactif pour cet exercice est fermé ici).
    const o = openingForYmd(dayYmd);
    if (
      !o.activeDays
        .split(",")
        .map((s) => s.trim())
        .includes(dayKey)
    ) {
      return true;
    }
    if (
      coveringPeriod?.dateStart &&
      coveringPeriod.dateEnd &&
      (dayYmd < coveringPeriod.dateStart || dayYmd > coveringPeriod.dateEnd)
    ) {
      return true;
    }
    if (!o.openOnHolidays && isFrenchHoliday(dayYmd)) return true;
    return !o.openOnSchoolHolidays && isInSchoolHolidayRange(dayYmd, schoolHolidays);
  };
  const isHolidayDay = (dayKey: string): boolean => {
    if (!active || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    if (openingForYmd(dayYmd).openOnHolidays) return false;
    return isFrenchHoliday(dayYmd);
  };
  const isSchoolHolidayDay = (dayKey: string): boolean => {
    if (!active || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    if (openingForYmd(dayYmd).openOnSchoolHolidays) return false;
    return isInSchoolHolidayRange(dayYmd, schoolHolidays);
  };
  // Classe de grisage : férié ou vacances scolaires → hachis is-holiday ;
  // hors période → hachis is-out-of-period (visuel identique, cf. doc ci-dessus).
  const outOfPeriodCls = (dayKey: string): string => {
    if (!isDayDisabled(dayKey)) return "";
    return isHolidayDay(dayKey) || isSchoolHolidayDay(dayKey) ? " is-holiday" : " is-out-of-period";
  };
  return { isDayDisabled, isHolidayDay, isSchoolHolidayDay, outOfPeriodCls };
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

/** Ids des créneaux ponctuels AUTONOMES (non miroirs) — à appeler sous useMemo. */
export function autonomousUniqueIds(uniqueSlots: UniqueSlot[]): Set<string> {
  return new Set(uniqueSlots.filter((s) => !s.parentSlotId).map((s) => s.id));
}

/** Slots MIROIRS (matérialisations datées des récurrents) → slot parent + date.
 * Sert à rattacher les réservations-ENFANTS à la cellule du parent en semaine
 * réelle — à appeler sous useMemo. */
export function buildMirrorMap(
  uniqueSlots: UniqueSlot[],
): Map<string, { parentSlotId: string; slotDate: string | null }> {
  return new Map(
    uniqueSlots
      .filter((s) => s.parentSlotId)
      .map((s) => [s.id, { parentSlotId: s.parentSlotId as string, slotDate: s.slotDate }]),
  );
}

/** Libellé daté (jour + mois courts) de chaque jour de la semaine réelle, par dayKey. */
export function weekDateLabels(mondayStr: string | null, days: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (mondayStr) {
    for (const d of days) out[d] = shortDateFmt.format(addDays(mondayStr, DAY_OFFSET[d] ?? 0));
  }
  return out;
}

/** Périodes visibles = celles de l'exercice courant (toutes si aucun exercice). */
export function visiblePeriodsOf<P extends { exerciceId: number | null }>(
  periods: P[],
  currentExerciceId: number | null,
): P[] {
  return currentExerciceId == null
    ? periods
    : periods.filter((p) => p.exerciceId === currentExerciceId);
}

/** La date du jour tombe-t-elle dans une des périodes ? (bouton « Aujourd'hui »). */
export function periodsCoverToday(
  periods: { dateStart: string | null; dateEnd: string | null }[],
  todayYmd: string,
): boolean {
  return periods.some(
    (p) => p.dateStart && p.dateEnd && p.dateStart <= todayYmd && p.dateEnd >= todayYmd,
  );
}

/**
 * MOTEUR DE PROJECTION des blocs par jour — cœur commun des deux grilles (audit
 * 2026-07-17 : ~200 lignes jumelles par grille). Étapes : projection des ponctuels
 * datés de la semaine en slots virtuels mono-jour → groupage des réservations par
 * cellule `dayKey|slotId` (enfant → cellule du slot PARENT, ponctuelle → son bloc
 * projeté, parente récurrente → son jour en Modèle seulement) → cellules candidates
 * (créneaux de la période active + union avec les cellules réservées) → un bloc par
 * créneau avec `used`/`full` selon la jauge → répartition des chevauchements.
 *
 * Points d'extension (fermés par défaut) :
 *  - `routeBooking` (usager) : re-routage AMONT d'une réservation (déplacement en
 *    brouillon) — "default" = règles standard, "skip" = masquée, sinon cellule cible ;
 *  - `projectRecurringParent` (admin en Modèle) : projette la réservation récurrente
 *    PARENTE sur son jour — en semaine réelle, les parentes sont toujours ignorées
 *    (leurs enfants datés s'affichent à leur place) ;
 *  - `injectExtra` (usager) : entrées synthétiques ajoutées APRÈS le groupage
 *    standard (occurrences non matérialisées de « mes récurrentes »).
 * À appeler sous useMemo (les deux grilles) — le moteur est pur.
 */
export function buildBlocksByDay<
  B extends {
    id: number;
    slotId: string;
    dayKey: string;
    periodId: number;
    week: string;
    enfants: number;
    accompagnants: number;
  },
>(args: {
  slots: Slot[];
  uniqueSlots: UniqueSlot[];
  bookings: B[];
  days: string[];
  mondayStr: string | null;
  sundayStr: string | null;
  /** Semaine réelle active (admin : mode === "realweek" ; usager : toujours vrai). */
  realweek: boolean;
  effectivePeriodId: number | null;
  effectiveWeek: "A" | "B" | null;
  abMode: boolean;
  gridStartMin: number;
  serviceCapacity: number;
  gaugeAccompagnants: boolean;
  /** Ids des créneaux ponctuels AUTONOMES (non miroirs). */
  uniqueIdSet: Set<string>;
  /** Slot miroir → parent + date (rattachement des réservations-enfants). */
  mirrorMap: Map<string, { parentSlotId: string; slotDate: string | null }>;
  projectRecurringParent: boolean;
  routeBooking?: (b: B) => { dayKey: string; slotId: string } | "skip" | "default";
  injectExtra?: (ctx: {
    groups: Map<string, B[]>;
    pushGroup: (key: string, b: B) => void;
    slotById: Map<string, Slot>;
  }) => void;
}): Record<string, AgendaBlockBase<B>[]> {
  const {
    slots,
    uniqueSlots,
    bookings,
    days,
    mondayStr,
    sundayStr,
    realweek,
    effectivePeriodId,
    effectiveWeek,
    abMode,
    gridStartMin,
    serviceCapacity,
    gaugeAccompagnants,
    uniqueIdSet,
    mirrorMap,
    projectRecurringParent,
    routeBooking,
    injectExtra,
  } = args;

  // Créneaux ponctuels (datés) → en semaine réelle, projetés sur le jour de la
  // semaine affichée correspondant à leur date, sous forme de slots virtuels
  // mono-jour : blocs/layout/rendu les traitent comme des créneaux normaux
  // (legacy renderAgendaWeekly, branche realweek). Seuls les ponctuels AUTONOMES
  // sont projetés — les miroirs sont couverts par leurs récurrents.
  const ponctuelSlots: Slot[] = [];
  if (realweek && mondayStr) {
    const sunday = sundayStr ?? mondayStr;
    for (const u of uniqueSlots) {
      if (u.parentSlotId) continue;
      if (!u.slotDate || u.slotDate < mondayStr || u.slotDate > sunday) continue;
      const dk = dayKeyFromYmd(u.slotDate);
      if (!days.includes(dk)) continue;
      ponctuelSlots.push({
        id: u.id,
        startTime: u.startTime,
        endTime: u.endTime,
        capacity: u.capacity ?? serviceCapacity,
        slotDay: dk,
        // periodId aligné sur la période effective pour passer le filtre de période.
        periodId: effectivePeriodId,
        weeks: null,
        jauge: u.jauge,
        slotDate: u.slotDate,
      });
    }
  }
  const allSlots = ponctuelSlots.length ? [...slots, ...ponctuelSlots] : slots;
  const slotById = new Map(allSlots.map((s) => [s.id, s]));

  // Le créneau tourne-t-il sur la semaine active (filtre A/B) ?
  const slotMatchesWeek = (slot: Slot): boolean => {
    if (!abMode || effectiveWeek == null) return true;
    return parseWeeks(slot.weeks).includes(effectiveWeek);
  };

  // Réservations groupées par dayKey|slotId (filtrées période + semaine).
  const groups = new Map<string, B[]>();
  const pushGroup = (key: string, b: B) => {
    const arr = groups.get(key) ?? [];
    arr.push(b);
    groups.set(key, arr);
  };
  const uniqSunday = sundayStr ?? mondayStr;
  // Lookup par id (un .find dans la boucle serait O(B×U)).
  const uniqById = new Map(uniqueSlots.map((s) => [s.id, s]));
  for (const b of bookings) {
    // Point d'extension AMONT : re-routage (usager : déplacement en brouillon).
    if (routeBooking) {
      const route = routeBooking(b);
      if (route === "skip") continue;
      if (route !== "default") {
        pushGroup(`${route.dayKey}|${route.slotId}`, b);
        continue;
      }
    }
    // Réservation-ENFANT (matérialisation d'une récurrente sur un slot miroir daté) :
    // en semaine réelle, rattachée à la cellule du SLOT PARENT du jour affiché (elle
    // y porte le pointage). En Modèle, c'est la parente qui s'affiche.
    const mir = mirrorMap.get(b.slotId);
    if (mir) {
      if (!realweek || !mondayStr) continue;
      if (!mir.slotDate || mir.slotDate < mondayStr || (uniqSunday && mir.slotDate > uniqSunday))
        continue;
      const dk = dayKeyFromYmd(mir.slotDate);
      if (!days.includes(dk)) continue;
      pushGroup(`${dk}|${mir.parentSlotId}`, b);
      continue;
    }
    // Réservation PONCTUELLE autonome : rattachée à son bloc ponctuel projeté (clé
    // jour = jour de la date du créneau), en ignorant période/semaine.
    if (uniqueIdSet.has(b.slotId)) {
      if (!realweek || !mondayStr) continue;
      const u = uniqById.get(b.slotId);
      if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
        continue;
      const dk = dayKeyFromYmd(u.slotDate);
      if (!days.includes(dk)) continue;
      pushGroup(`${dk}|${b.slotId}`, b);
      continue;
    }
    // Réservation RÉCURRENTE parente : en semaine réelle, ses enfants datés
    // s'affichent (ci-dessus) → jamais projetée ; en Modèle, projection sur son
    // jour si l'appelant le demande (admin).
    if (realweek || !projectRecurringParent) continue;
    if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
    // A/B : une résa sans semaine ("") vaut pour les deux semaines.
    if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
    pushGroup(`${b.dayKey}|${b.slotId}`, b);
  }

  // Point d'extension AVAL : entrées synthétiques (usager).
  injectExtra?.({ groups, pushGroup, slotById });

  // === Cellules candidates ===
  // Pour chaque créneau de la période active, sur chaque jour actif du service où
  // une capacité est configurée → cellule candidate (même sans réservation). C'est
  // ce qui fait apparaître les créneaux vides cliquables (port du legacy).
  const candidates = new Map<string, { slotId: string; dayKey: string }>();
  for (const slot of allSlots) {
    if (effectivePeriodId != null && slot.periodId !== effectivePeriodId) continue;
    if (!slotMatchesWeek(slot)) continue;
    // Modèle « un slot = un jour » : le créneau s'affiche sur SON jour (slotDay),
    // avec repli sur serviceCapacity si la capacité n'est pas fixée. Capacité 0 = fermé.
    const dayKey = slot.slotDay;
    if (!dayKey || !days.includes(dayKey)) continue;
    const c = slot.capacity ?? serviceCapacity;
    if (c <= 0) continue;
    candidates.set(`${dayKey}|${slot.id}`, { slotId: slot.id, dayKey });
  }
  // Union avec les cellules portant des réservations : aucune résa n'est perdue,
  // même sur un jour sans capacité configurée (donnée de seed incohérente possible).
  for (const key of groups.keys()) {
    if (candidates.has(key)) continue;
    const [dayKey, slotId] = key.split("|");
    candidates.set(key, { slotId, dayKey });
  }

  // Un bloc PAR CRÉNEAU (slot) regroupant toutes ses réservations (modèle legacy
  // renderAgendaWeekly), au lieu d'un bloc par réservation juxtaposé.
  const byDay: Record<string, AgendaBlockBase<B>[]> = {};
  for (const { slotId, dayKey } of candidates.values()) {
    const slot = slotById.get(slotId);
    if (!slot) continue;
    const list = groups.get(`${dayKey}|${slotId}`) ?? [];
    // Créneau sans horaire (début ou fin vide) → « journée entière ».
    const allday = !slot.startTime || !slot.endTime;
    const s = toMinutes(slot.startTime, gridStartMin);
    const e = toMinutes(slot.endTime, s + 60);
    const capacity = dayCap(slot, dayKey) ?? slot.capacity ?? serviceCapacity;
    // Places occupées, conditionnées à la jauge DE CE CRÉNEAU (slots.jauge, posée à
    // la création) : en jauge = somme (enfants + adultes si comptés) ; hors jauge =
    // nombre de réservations. Gater ici rend `used`/`full` cohérents pour TOUS les
    // consommateurs (libellé, barre, flag « complet », modale pile).
    const used = slot.jauge
      ? list.reduce((sum, b) => sum + gaugeUnits(b.enfants, b.accompagnants, gaugeAccompagnants), 0)
      : list.length;
    // Un bloc vide (used=0) n'est jamais "complet".
    const full = used >= capacity && used > 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: init-or-push concis sur la map par jour
    (byDay[dayKey] ??= []).push({
      slotId,
      dayKey,
      bookings: list,
      startMin: s,
      endMin: e,
      leftPct: 0,
      widthPct: 100,
      used,
      capacity,
      full,
      jauge: slot.jauge,
      isAllDay: allday,
    });
  }
  // Chevauchements horaires : sur chaque colonne-jour, les créneaux qui se
  // recouvrent dans le temps sont répartis sur N colonnes (cf. _agendaLayoutOverlaps).
  for (const dayKey of Object.keys(byDay)) {
    // Les blocs « journée entière » ne sont pas positionnés sur la grille horaire :
    // ils gardent leftPct:0/widthPct:100 et sont rendus dans la bande dédiée.
    const blocks = byDay[dayKey].filter((bl) => !bl.isAllDay);
    const items: (LayoutItem & { block: AgendaBlockBase<B> })[] = blocks.map((bl) => {
      const slot = slotById.get(bl.slotId);
      return {
        startMin: toMinutes(slot?.startTime ?? "", gridStartMin),
        endMin: toMinutes(slot?.endTime ?? "", gridStartMin + 60),
        col: 0,
        colCount: 1,
        block: bl,
      };
    });
    layoutOverlaps(items);
    for (const it of items) {
      it.block.leftPct = it.col * (100 / it.colCount);
      it.block.widthPct = 100 / it.colCount;
    }
  }
  return byDay;
}
