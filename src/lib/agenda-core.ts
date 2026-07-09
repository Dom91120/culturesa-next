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
