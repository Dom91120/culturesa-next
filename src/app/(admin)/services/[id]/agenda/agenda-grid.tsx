"use client";

import type { ServiceModes } from "@/server/services/service-modes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  createRecurringBookingAction,
  createUniqueBookingAction,
  deleteBookingAdminAction,
  moveBookingAction,
  setBookingPointageAction,
  setBookingValidatedAction,
  updateBookingDetailAction,
} from "./actions";

type Service = {
  id: string;
  label: string;
  activeDays: string;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  recurCapacity: number;
  semaineAb: boolean;
  themesMode: "libre" | "liste";
  openOnHolidays: boolean;
};
type Period = {
  id: number;
  label: string;
  color: string;
  dateStart: string;
  dateEnd: string;
  exerciceId: number | null;
};
type Exercice = { id: number; label: string };

const DAY_OFFSET: Record<string, number> = {
  lun: 0,
  mar: 1,
  mer: 2,
  jeu: 3,
  ven: 4,
  sam: 5,
  dim: 6,
};

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - day);
  return x;
}
function addDays(iso: string, n: number): Date {
  const x = new Date(`${iso}T00:00:00`);
  x.setDate(x.getDate() + n);
  return x;
}
const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

// Calcul de Pâques (algorithme de Gauss/Butcher) — port exact du legacy _easterDate.
function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
// Jour férié français (fixes + lundi de Pâques/Ascension/Pentecôte) — port du legacy
// _isFrenchHoliday. dateStr au format "YYYY-MM-DD".
function isFrenchHoliday(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const fixed = [
    [1, 1],
    [5, 1],
    [5, 8],
    [7, 14],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
  ];
  if (fixed.some(([m, d]) => m === month && d === day)) return true;
  const e = easterDate(year);
  const fmt = (date: Date) => date.toISOString().slice(0, 10);
  const dayMs = 86400000;
  // Offsets : lundi de Pâques (+1), Ascension (+39), lundi de Pentecôte (+50).
  return [1, 39, 50].some((off) => fmt(new Date(e.getTime() + off * dayMs)) === dateStr);
}

// Clé jour (lun..dim) d'une date "YYYY-MM-DD" — pour projeter un créneau ponctuel
// daté sur la bonne colonne jour de l'agenda (legacy _agendaDayKeyFromYmd).
const YMD_DAY_KEYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
function dayKeyFromYmd(ymd: string): string {
  return YMD_DAY_KEYS[new Date(`${ymd}T00:00:00`).getDay()] ?? "";
}

/** Numéro de semaine ISO (1..53) — sert à déduire la parité A/B en semaine réelle. */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fdn = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdn + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}
type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  capLun: number | null;
  capMar: number | null;
  capMer: number | null;
  capJeu: number | null;
  capVen: number | null;
  capSam: number | null;
  capDim: number | null;
  periodId: number | null;
  weeks: string | null;
  // Renseigné uniquement pour les créneaux ponctuels projetés (slots virtuels).
  slotDate?: string | null;
};
// Créneau ponctuel (daté) tel que chargé pour l'agenda.
// parentSlotId non nul = créneau "miroir" (matérialisation d'un récurrent) ; null =
// ponctuel autonome (affiché en vert dans le legacy).
type UniqueSlot = {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  slotDate: string;
  parentSlotId: string | null;
};

// Semaines où le créneau "tourne" (port de la colonne weeks). null / "A,B" = toutes.
function parseWeeks(weeks: string | null): ("A" | "B")[] {
  if (!weeks) return ["A", "B"];
  const set = new Set(
    weeks
      .split(",")
      .map((w) => w.trim().toUpperCase())
      .filter((w) => w === "A" || w === "B"),
  );
  return set.size ? (Array.from(set) as ("A" | "B")[]) : ["A", "B"];
}

function dayCap(slot: Slot, dayKey: string): number | null {
  switch (dayKey) {
    case "lun":
      return slot.capLun;
    case "mar":
      return slot.capMar;
    case "mer":
      return slot.capMer;
    case "jeu":
      return slot.capJeu;
    case "ven":
      return slot.capVen;
    case "sam":
      return slot.capSam;
    case "dim":
      return slot.capDim;
    default:
      return null;
  }
}
type Pointage = "present" | "absent" | null;
type Booking = {
  id: number;
  slotId: string;
  periodId: number;
  dayKey: string;
  week: string;
  enfants: number;
  accompagnants: number;
  theme: string;
  validated: boolean;
  pointage: Pointage;
  name: string;
  demandeur: string;
  structure: string;
};
type UserOpt = { id: string; label: string };

const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

const ROW_H = 56;

// Feuille de style autonome pour la fenêtre d'impression : ne reprend que les
// classes nécessaires au rendu de la grille agenda (équivalent legacy printAgenda).
const PRINT_CSS = `
  body{font-family:system-ui,Segoe UI,sans-serif;margin:1rem;color:#1a1a1a}
  h1{font-size:1.1rem;margin:0 0 1rem}
  .planning-wrap{position:relative}
  .agenda-grid{display:grid;gap:0;border:1px solid #ccc;border-radius:8px;overflow:hidden;background:#fff}
  .agenda-header-cell{background:#f3f3f3;padding:.4rem .3rem;font-size:.72rem;font-weight:700;text-align:center;border-bottom:1px solid #ccc;border-left:1px solid #ccc;display:flex;flex-direction:column;align-items:center;gap:1px}
  .agenda-corner{border-left:none}
  .agenda-day-sub{font-size:.6rem;color:#666;font-weight:600}
  .agenda-time-col{position:relative;border-right:1px solid #ccc}
  .agenda-time-mark{position:absolute;right:4px;font-size:.6rem;color:#666;transform:translateY(-50%)}
  .agenda-day-col{position:relative;border-left:1px solid #ccc;min-height:40px}
  .agenda-grid-line{position:absolute;left:0;right:0;border-top:1px solid #e2e2e2}
  .agenda-grid-line.is-hour{border-top-color:#bbb}
  .agenda-block{position:absolute;border-radius:6px;padding:2px 4px;overflow:hidden;display:flex;flex-direction:column;gap:2px;font-size:.62rem;background:#f0c14b;border:1px solid #b89020;color:#3a2f00}
  .agenda-block-chips{display:flex;flex-direction:column;gap:1px;overflow:hidden;flex:1}
  .agenda-block-meta{font-size:.58rem;font-weight:700;display:flex;align-items:center;gap:3px}
  .agenda-block-gauge-bar{flex:1;height:4px;border-radius:2px;background:rgba(0,0,0,.15);overflow:hidden;display:inline-block;min-width:24px}
  .agenda-block-gauge-bar>span{display:block;height:100%;background:#b89020}
  .planning-name-tag{display:inline-flex;flex-direction:column;font-size:.62rem;font-weight:700}
  @media print{@page{size:landscape;margin:1cm}}
`;

function toMinutes(t: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Couleurs de base des badges, reprises de `_badgeStyle(bk)` du legacy (app.js) :
// validé = fond vert clair + bordure accent ; en attente = fond orange clair +
// bordure orange. Le texte reste lisible via --badge-text (fallback inline).
function badgeStyle(validated: boolean): React.CSSProperties {
  return validated
    ? {
        background: "#c8e8d4",
        borderColor: "var(--accent)",
        color: "var(--badge-text, #1a1f2e)",
      }
    : {
        background: "#f3dfbb",
        borderColor: "rgba(232, 164, 90, .45)",
        color: "var(--badge-text, #1a1f2e)",
      };
}

// Pastille de pointage P (présent, vert) / A (absent, rouge) affichée en haut à
// droite du badge, reprise du legacy `_badgeIndicators` (classes .indic_p /
// .indic_a). Le pointage n'existe que sur les réservations ponctuelles datées,
// donc cette pastille n'apparaît qu'en « Semaine réelle ». Le badge parent doit
// être `position: relative` pour l'ancrer.
function PointagePill({ pointage }: { pointage: Pointage }) {
  if (!pointage) return null;
  return (
    <span
      style={{
        position: "absolute",
        right: 3,
        top: 3,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "center",
        zIndex: 1,
      }}
    >
      <span className={pointage === "present" ? "indic_p" : "indic_a"}>
        {pointage === "present" ? "P" : "A"}
      </span>
    </span>
  );
}

// Bloc = UN créneau (slot) un jour donné, regroupant toutes ses réservations.
type Block = {
  slotId: string;
  dayKey: string;
  bookings: Booking[];
  // Minutes brutes du créneau : top/height (px) sont dérivés AU RENDU via mapMinToY
  // (qui dépend du compactage pause/hideEmpty, recalculé hors useMemo).
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
type LayoutItem = { startMin: number; endMin: number; col: number; colCount: number };
function layoutOverlaps(items: LayoutItem[]): void {
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

type Detail = { booking: Booking } | null;
type CreateCtx = {
  dayKey: string;
  slotId: string;
  // Créneau ponctuel : réservation ponctuelle (pas de période / jour) + date affichée.
  ponctuel?: boolean;
  slotDate?: string;
} | null;

export function AgendaGrid({
  service,
  periods,
  slots,
  uniqueSlots,
  bookings,
  users,
  themes,
  modes,
  exercices,
  showPrevious,
}: {
  service: Service;
  periods: Period[];
  slots: Slot[];
  uniqueSlots: UniqueSlot[];
  bookings: Booking[];
  users: UserOpt[];
  themes: string[];
  modes: ServiceModes;
  exercices: Exercice[];
  showPrevious: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Exercice courant : par défaut le plus récent (dernier après tri par libellé).
  const [currentExerciceId, setCurrentExerciceId] = useState<number | null>(
    exercices.length ? exercices[exercices.length - 1].id : null,
  );
  const [periodIdx, setPeriodIdx] = useState(0);
  const [mode, setMode] = useState<"model" | "realweek">("model");
  const [anchorMonday, setAnchorMonday] = useState<string | null>(null);
  // Mode "Semaine réelle" : période active verrouillée. Sans ce verrou, on
  // re-dérive la période depuis la semaine à chaque ◀/▶ — et quand une semaine
  // chevauche la frontière de deux périodes contiguës, elle bascule sur la
  // voisine (dont les bornes laissent sortir). Cf. legacy _agendaPeriodUserPicked.
  const [rwPeriodId, setRwPeriodId] = useState<number | null>(null);
  const [weekAB, setWeekAB] = useState<"A" | "B">("A");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [validation, setValidation] = useState(false);
  const [pointageMode, setPointageMode] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  // Modale "pile" : liste des réservations d'un créneau (clé slot+jour, recalculée
  // en direct depuis blocksByDay pour rester à jour après un refresh).
  const [stackKey, setStackKey] = useState<{ slotId: string; dayKey: string } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [createCtx, setCreateCtx] = useState<CreateCtx>(null);
  const [cUser, setCUser] = useState("");
  const [cEnfants, setCEnfants] = useState("0");
  const [cTheme, setCTheme] = useState("");
  const [cError, setCError] = useState<string | null>(null);

  const days = service.activeDays
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const startMin = toMinutes(service.morningStart, 9 * 60);
  const endMin = toMinutes(service.afternoonEnd, 18 * 60);
  const baseFirst = Math.floor(startMin / 60);
  const baseLast = Math.ceil(endMin / 60);

  // Périodes visibles = celles de l'exercice courant (toutes si aucun exercice).
  const visiblePeriods =
    currentExerciceId == null ? periods : periods.filter((p) => p.exerciceId === currentExerciceId);
  const selectedPeriodId = visiblePeriods[periodIdx]?.id ?? null;

  // Navigation entre exercices (◀ label ▶).
  const exIdx = exercices.findIndex((e) => e.id === currentExerciceId);
  const exLabel = exIdx >= 0 ? exercices[exIdx].label : "—";
  const canExPrev = exIdx > 0 && showPrevious;
  const canExNext = exIdx >= 0 && exIdx < exercices.length - 1;
  function gotoExercice(id: number) {
    setCurrentExerciceId(id);
    setPeriodIdx(0);
  }

  // ── Mode "Semaine réelle" : semaine datée + période couvrant cette semaine ──
  const mondayStr = anchorMonday;
  const sundayStr = mondayStr ? ymd(addDays(mondayStr, 6)) : null;
  // Une période "couvre" une date si celle-ci est dans [dateStart, dateEnd].
  const periodCoveringDate = (d: string) =>
    periods.find((p) => p.dateStart && p.dateEnd && p.dateStart <= d && p.dateEnd >= d) ?? null;
  // Période active : priorité à celle verrouillée (rwPeriodId) tant qu'elle
  // intersecte la semaine — sinon on dérive depuis l'ancre (lundi puis mercredi,
  // pour les périodes commençant en milieu de semaine). Cf. legacy l.6469-6480.
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
  // En semaine réelle sans période couvrante, -1 ne matche rien → aucun bloc.
  const effectivePeriodId = mode === "realweek" ? (coveringPeriod?.id ?? -1) : selectedPeriodId;

  // Dates (YYYY-MM-DD) des créneaux ponctuels (datés) ayant au moins une réservation
  // (port legacy _agendaBookedSlotDates). Trié croissant.
  const bookedSlotDates = uniqueSlots
    .filter((s) => s.slotDate && bookings.some((b) => b.slotId === s.id))
    .map((s) => s.slotDate as string)
    .sort();
  // Parités A/B couvertes par les réservations RÉCURRENTES (periodId > 0) de chaque
  // période. Une résa sans semaine ("") vaut pour A ET B. Ces résas se répètent chaque
  // semaine de la période → une semaine est « non vide » seulement si sa parité figure
  // ici. (Hors mode A/B, on enregistre "A"/"B"/"" sans distinction — voir weekHasBooking.)
  const recurAbByPeriod = new Map<number, Set<"A" | "B" | "">>();
  for (const b of bookings) {
    if (b.periodId <= 0) continue;
    const set = recurAbByPeriod.get(b.periodId) ?? new Set<"A" | "B" | "">();
    set.add((b.week === "A" || b.week === "B" ? b.week : "") as "A" | "B" | "");
    recurAbByPeriod.set(b.periodId, set);
  }

  // Une semaine (lundi → dimanche) contient-elle une réservation visible ?
  // - ponctuel daté réservé dans la semaine, OU
  // - réservation récurrente de la période couvrant la semaine, dont la parité A/B
  //   est compatible avec celle de la semaine (en mode A/B). "" = vaut pour A et B.
  const weekHasBooking = (monday: string): boolean => {
    const sunday = ymd(addDays(monday, 6));
    if (bookedSlotDates.some((d) => d >= monday && d <= sunday)) return true;
    const p = periodCoveringDate(monday) ?? periodCoveringDate(ymd(addDays(monday, 3)));
    if (p == null) return false;
    const ab = recurAbByPeriod.get(p.id);
    if (!ab || ab.size === 0) return false;
    if (!modes.abMode) return true; // pas de distinction A/B → toute résa récurrente compte
    const parity: "A" | "B" = isoWeek(new Date(`${monday}T00:00:00`)) % 2 === 1 ? "A" : "B";
    return ab.has("") || ab.has(parity);
  };
  // Existe-t-il une semaine non vide au-delà de `monday` dans la direction donnée,
  // sans sortir de la période active ? (pour activer/désactiver ◀/▶ en hideEmpty)
  const hasBookedWeekBeyond = (monday: string, dir: 1 | -1): boolean => {
    const startB = coveringPeriod?.dateStart;
    const endB = coveringPeriod?.dateEnd;
    let cur = ymd(addDays(monday, dir * 7));
    for (let i = 0; i < 260; i++) {
      const sunday = ymd(addDays(cur, 6));
      if (endB && cur > endB) break;
      if (startB && sunday < startB) break;
      if (weekHasBooking(cur)) return true;
      cur = ymd(addDays(cur, dir * 7));
    }
    return false;
  };

  // Bornes de navigation hebdo : on reste dans la période sélectionnée (celle qui
  // couvre la semaine courante) et on ne navigue pas au-delà de ses dates.
  // En mode hideEmpty, on désactive aussi ◀/▶ s'il n'existe plus aucune semaine
  // AVEC réservation dans la direction (cf. legacy renderAgendaWeekly).
  const canWeekPrev = mondayStr
    ? (coveringPeriod?.dateStart
        ? ymd(addDays(mondayStr, -1)) >= coveringPeriod.dateStart
        : true) &&
      (!hideEmpty || hasBookedWeekBeyond(mondayStr, -1))
    : false;
  const canWeekNext = mondayStr
    ? (coveringPeriod?.dateEnd ? ymd(addDays(mondayStr, 7)) <= coveringPeriod.dateEnd : true) &&
      (!hideEmpty || hasBookedWeekBeyond(mondayStr, 1))
    : false;

  // Navigation hebdo (◀/▶) : en mode hideEmpty, on saute aux semaines AYANT au moins
  // une réservation (ponctuelle OU récurrente — port legacy shiftAgendaWeek), bornée
  // à la période active.
  function shiftWeek(deltaWeeks: number) {
    if (!mondayStr) return;
    let newAnchor = ymd(addDays(mondayStr, deltaWeeks * 7));
    if (hideEmpty && deltaWeeks !== 0) {
      const step = deltaWeeks > 0 ? 7 : -7;
      const MAX_ITER = 260;
      let iter = 0;
      while (iter++ < MAX_ITER) {
        if (weekHasBooking(newAnchor)) break;
        if (!hasBookedWeekBeyond(newAnchor, deltaWeeks > 0 ? 1 : -1)) break;
        newAnchor = ymd(addDays(newAnchor, step));
      }
    }
    // Clamp à la période active : si le saut sort de la période, on annule.
    if (coveringPeriod?.dateStart && coveringPeriod.dateEnd) {
      const newSunday = ymd(addDays(newAnchor, 6));
      if (newAnchor > coveringPeriod.dateEnd || newSunday < coveringPeriod.dateStart) return;
    }
    setAnchorMonday(newAnchor);
  }
  // Libellé daté de chaque jour de la semaine réelle, par dayKey.
  const weekDateByDay: Record<string, string> = {};
  if (mondayStr) {
    for (const d of days)
      weekDateByDay[d] = shortDateFmt.format(addDays(mondayStr, DAY_OFFSET[d] ?? 0));
  }
  // Jour fermé : uniquement en semaine réelle, pour un jour hors de la période
  // active OU férié quand le service ferme les fériés. Contrairement au legacy
  // (grisage purement visuel), on bloque ici aussi toutes les interactions.
  const isDayDisabled = (dayKey: string): boolean => {
    if (mode !== "realweek" || !mondayStr) return false;
    const dayYmd = ymd(addDays(mondayStr, DAY_OFFSET[dayKey] ?? 0));
    if (
      coveringPeriod?.dateStart &&
      coveringPeriod.dateEnd &&
      (dayYmd < coveringPeriod.dateStart || dayYmd > coveringPeriod.dateEnd)
    ) {
      return true;
    }
    return !service.openOnHolidays && isFrenchHoliday(dayYmd);
  };
  // Classe de grisage (hachures + opacité), portée du legacy _outOfPeriodCls.
  const outOfPeriodCls = (dayKey: string): string =>
    isDayDisabled(dayKey) ? " is-out-of-period" : "";

  // ── Semaines A/B ── (dérivé de la matrice demandeurs, pas de la colonne service)
  const abMode = modes.abMode;
  const realWeekParity: "A" | "B" | null = mondayStr
    ? isoWeek(new Date(`${mondayStr}T00:00:00`)) % 2 === 1
      ? "A"
      : "B"
    : null;
  // Semaine effective filtrée : en modèle = choix A/B ; en réel = parité de la date.
  const effectiveWeek: "A" | "B" | null = abMode
    ? mode === "model"
      ? weekAB
      : realWeekParity
    : null;

  // La plage horaire affichée reste fixe (matin → après-midi). « Masquer les
  // horaires sans réservation » ne resserre pas la plage : il COMPACTE les quarts
  // d'heure non occupés (cf. legacy renderAgendaWeekly), géré plus bas via `quarters`.
  const firstHour = baseFirst;
  const lastHour = baseLast;

  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const gridStartMin = firstHour * 60;
  const gridEndMin = lastHour * 60;
  const QUARTER_H = ROW_H / 4; // px par tranche de 15 min

  // Ids des créneaux ponctuels AUTONOMES (non miroirs) : affichés en vert et en
  // lecture seule (on neutralise la création/déplacement de résa récurrente dessus ;
  // la réservation ponctuelle relève d'un autre flux).
  const uniqueIdSet = useMemo(
    () => new Set(uniqueSlots.filter((s) => !s.parentSlotId).map((s) => s.id)),
    [uniqueSlots],
  );

  // ── Pause méridienne (port legacy renderAgendaWeekly) ───────────────────────
  // Zone entre morningEnd et afternoonStart. Si > 30 min, on COMPACTE : on ne garde
  // que 2 quarts visuels (30 min) — les quarts au-delà de lunchStart+30 sont sautés.
  // Le reste de la grille (lignes, heures, blocs, clics) suit un mapping par quarts
  // d'heure VISIBLES (mapMinToY), au lieu d'un mapping linéaire heure/heure.
  const lunchStart = toMinutes(service.morningEnd, Number.NaN);
  const lunchEnd = toMinutes(service.afternoonStart, Number.NaN);
  const hasLunch =
    Number.isFinite(lunchStart) &&
    Number.isFinite(lunchEnd) &&
    lunchEnd > lunchStart &&
    lunchStart >= gridStartMin &&
    lunchEnd <= gridEndMin;
  const lunchSkipFrom = hasLunch && lunchEnd - lunchStart > 30 ? lunchStart + 30 : null;

  // ── « Masquer les horaires sans réservation » (compactage, port legacy) ─────
  // On ne resserre pas la plage : on construit l'ensemble des quarts d'heure
  // OCCUPÉS (granularité HEURE : dès qu'un créneau avec ≥1 réservation visible
  // touche une heure, ses 4 quarts sont conservés pour garder le repère "heure").
  // Les quarts non occupés sont ensuite sautés dans `quarters`.
  const occupiedQ = new Set<number>();
  if (hideEmpty) {
    const occupiedHours = new Set<number>();
    // Ids des créneaux récurrents ayant une réservation visible (période + semaine A/B).
    const recBookedSlotIds = new Set<string>();
    // Ids des créneaux ponctuels (datés) ayant une réservation dans la semaine affichée.
    const uniqBookedSlotIds = new Set<string>();
    const uniqSunday = sundayStr ?? mondayStr;
    for (const b of bookings) {
      if (uniqueIdSet.has(b.slotId)) {
        if (mode !== "realweek" || !mondayStr) continue;
        const u = uniqueSlots.find((s) => s.id === b.slotId);
        if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
          continue;
        uniqBookedSlotIds.add(b.slotId);
        continue;
      }
      if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
      if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
      recBookedSlotIds.add(b.slotId);
    }
    const addHours = (sMin: number, eMin: number) => {
      const s = Math.max(sMin, gridStartMin);
      const e = Math.min(eMin, gridEndMin);
      if (e <= s) return;
      for (let m = Math.floor(s / 60) * 60; m < e; m += 60) occupiedHours.add(m);
    };
    for (const s of slots) {
      if (!recBookedSlotIds.has(s.id)) continue;
      addHours(toMinutes(s.startTime, gridStartMin), toMinutes(s.endTime, gridStartMin + 60));
    }
    for (const u of uniqueSlots) {
      if (!uniqBookedSlotIds.has(u.id)) continue;
      addHours(toMinutes(u.startTime, gridStartMin), toMinutes(u.endTime, gridStartMin + 60));
    }
    // Étend chaque heure occupée à ses 4 quarts (dans [gridStartMin, gridEndMin]).
    for (const h of occupiedHours) {
      for (let q = h; q < h + 60; q += 15) {
        if (q >= gridStartMin && q < gridEndMin) occupiedQ.add(q);
      }
    }
  }

  // Liste ordonnée des quarts d'heure visibles (minutes) : pause méridienne compactée
  // et, si hideEmpty, quarts non occupés sautés.
  const quarters: number[] = [];
  for (let m = gridStartMin; m < gridEndMin; m += 15) {
    if (hideEmpty && !occupiedQ.has(m)) continue;
    if (lunchSkipFrom !== null && m >= lunchSkipFrom && m < lunchEnd) continue;
    quarters.push(m);
  }
  const qIdx = new Map<number, number>();
  quarters.forEach((m, i) => qIdx.set(m, i));
  const totalH = quarters.length * QUARTER_H;
  // mapMinToY : minute réelle → y (px), linéaire intra-quart, basé sur les quarts
  // visibles (gère le compactage de la pause). Cf. legacy mapMinToY.
  const mapMinToY = (min: number): number => {
    const q = Math.floor(min / 15) * 15;
    const offset = (min - q) / 15; // 0..1
    const idx = qIdx.get(q);
    if (idx !== undefined) return (idx + offset) * QUARTER_H;
    // Quart non visible (dans la pause compactée) : on colle au dernier quart visible amont.
    let prev = -1;
    for (const qv of quarters) {
      if (qv >= q) break;
      const i = qIdx.get(qv);
      if (i !== undefined) prev = i;
    }
    return (prev + 1) * QUARTER_H;
  };
  // Inverse de mapMinToY pour le clic (y → minute). Trouve le quart visible sous y.
  const yToMin = (y: number): number => {
    const idx = Math.floor(y / QUARTER_H);
    const clamped = Math.max(0, Math.min(quarters.length - 1, idx));
    const base = quarters[clamped] ?? gridStartMin;
    const offset = y - clamped * QUARTER_H; // px dans le quart
    return base + (offset / QUARTER_H) * 15;
  };

  const slotsParsed = useMemo(
    () =>
      slots.map((s) => ({
        ...s,
        startMin: toMinutes(s.startTime, gridStartMin),
        endMin: toMinutes(s.endTime, gridStartMin + 60),
      })),
    [slots, gridStartMin],
  );

  function slotAtClientY(colTop: number, clientY: number) {
    // y → minute via le mapping par quarts (gère le compactage de la pause).
    const minute = yToMin(clientY - colTop);
    return slotsParsed.find((s) => minute >= s.startMin && minute < s.endMin) ?? null;
  }

  const blocksByDay = useMemo(() => {
    // Créneaux ponctuels (datés) → en « Semaine réelle », on les projette sur le
    // jour de la semaine affichée correspondant à leur date, sous forme de slots
    // virtuels mono-jour : toute la logique de blocs/layout/rendu les traite alors
    // comme des créneaux normaux (legacy renderAgendaWeekly, branche realweek).
    const ponctuelSlots: Slot[] = [];
    if (mode === "realweek" && mondayStr) {
      const sunday = sundayStr ?? mondayStr;
      for (const u of uniqueSlots) {
        // Les miroirs (matérialisations de récurrents) sont déjà couverts par les
        // créneaux récurrents affichés directement → on ne projette que les ponctuels
        // autonomes (non miroirs), affichés en vert (cf. legacy).
        if (u.parentSlotId) continue;
        if (!u.slotDate || u.slotDate < mondayStr || u.slotDate > sunday) continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        const cap = u.capacity ?? service.recurCapacity;
        ponctuelSlots.push({
          id: u.id,
          startTime: u.startTime,
          endTime: u.endTime,
          capacity: u.capacity,
          capLun: dk === "lun" ? cap : null,
          capMar: dk === "mar" ? cap : null,
          capMer: dk === "mer" ? cap : null,
          capJeu: dk === "jeu" ? cap : null,
          capVen: dk === "ven" ? cap : null,
          capSam: dk === "sam" ? cap : null,
          capDim: dk === "dim" ? cap : null,
          // periodId aligné sur la période effective pour passer le filtre de période.
          periodId: effectivePeriodId,
          weeks: null,
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

    // Réservations groupées par dayKey|slotId (filtrées période + semaine, comme avant).
    const groups = new Map<string, Booking[]>();
    const pushGroup = (key: string, b: Booking) => {
      const arr = groups.get(key) ?? [];
      arr.push(b);
      groups.set(key, arr);
    };
    const uniqSunday = sundayStr ?? mondayStr;
    for (const b of bookings) {
      // Réservation PONCTUELLE : rattachée à son bloc ponctuel projeté (clé jour =
      // jour de la date du créneau), en ignorant période/semaine (un ponctuel n'en
      // a pas : periodId=0, dayKey="").
      if (uniqueIdSet.has(b.slotId)) {
        if (mode !== "realweek" || !mondayStr) continue;
        const u = uniqueSlots.find((s) => s.id === b.slotId);
        if (!u?.slotDate || u.slotDate < mondayStr || (uniqSunday && u.slotDate > uniqSunday))
          continue;
        const dk = dayKeyFromYmd(u.slotDate);
        if (!days.includes(dk)) continue;
        pushGroup(`${dk}|${b.slotId}`, b);
        continue;
      }
      if (effectivePeriodId != null && b.periodId !== effectivePeriodId) continue;
      // A/B : une résa sans semaine ("") vaut pour les deux semaines.
      if (effectiveWeek != null && b.week !== effectiveWeek && b.week !== "") continue;
      pushGroup(`${b.dayKey}|${b.slotId}`, b);
    }

    // === Cellules candidates ===
    // Pour chaque créneau de la période active, sur chaque jour actif du service où
    // une capacité est configurée → cellule candidate (même sans réservation). C'est
    // ce qui fait apparaître les créneaux vides cliquables (port du legacy).
    const candidates = new Map<string, { slotId: string; dayKey: string }>();
    for (const slot of allSlots) {
      if (effectivePeriodId != null && slot.periodId !== effectivePeriodId) continue;
      if (!slotMatchesWeek(slot)) continue;
      for (const dayKey of days) {
        // Capacité null OU 0 = pas de créneau ce jour-là → on ne l'affiche pas.
        const c = dayCap(slot, dayKey);
        if (c == null || c <= 0) continue;
        candidates.set(`${dayKey}|${slot.id}`, { slotId: slot.id, dayKey });
      }
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
    const byDay: Record<string, Block[]> = {};
    for (const { slotId, dayKey } of candidates.values()) {
      const slot = slotById.get(slotId);
      if (!slot) continue;
      const list = groups.get(`${dayKey}|${slotId}`) ?? [];
      // Créneau sans horaire (début ou fin vide) → « journée entière ».
      const allday = !slot.startTime || !slot.endTime;
      const s = toMinutes(slot.startTime, gridStartMin);
      const e = toMinutes(slot.endTime, s + 60);
      const capacity = dayCap(slot, dayKey) ?? slot.capacity ?? service.recurCapacity;
      const used = list.reduce((sum, b) => sum + b.enfants, 0);
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
        isAllDay: allday,
      });
    }
    // Chevauchements horaires : sur chaque colonne-jour, les créneaux qui se
    // recouvrent dans le temps sont répartis sur N colonnes (cf. _agendaLayoutOverlaps).
    // Chaque LayoutItem référence directement son bloc (id stable) → pas d'ambiguïté
    // si deux créneaux partagent les mêmes horaires.
    for (const dayKey of Object.keys(byDay)) {
      // Les blocs « journée entière » ne sont pas positionnés sur la grille horaire :
      // ils gardent leftPct:0/widthPct:100 et sont rendus dans la bande dédiée.
      const blocks = byDay[dayKey].filter((bl) => !bl.isAllDay);
      const items: (LayoutItem & { block: Block })[] = blocks.map((bl) => {
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
  }, [
    bookings,
    slots,
    uniqueSlots,
    uniqueIdSet,
    mode,
    mondayStr,
    sundayStr,
    days,
    abMode,
    effectivePeriodId,
    effectiveWeek,
    gridStartMin,
    service.recurCapacity,
  ]);

  function run(p: Promise<unknown>) {
    setDetail(null);
    startTransition(async () => {
      await p;
      router.refresh();
    });
  }

  // "Mode validation" et "Mode pointage" sont mutuellement exclusifs (comme legacy).
  function toggleValidation(on: boolean) {
    setValidation(on);
    if (on) setPointageMode(false);
  }
  function togglePointageMode(on: boolean) {
    setPointageMode(on);
    if (on) setValidation(false);
  }

  // Clic rapide sur un bloc en mode validation / pointage (sinon : ouvre le menu).
  function onBlockQuickAction(bk: Booking): boolean {
    if (validation) {
      // Une résa pointée est verrouillée : sa validation ne change plus (cf.
      // legacy openBadgeDetail/_ctxValidate). On laisse le clic ouvrir la fiche
      // (bouton Valider désactivé) plutôt que d'agir silencieusement.
      if (bk.pointage != null) return false;
      // Bascule validé ↔ en attente (legacy _quickValidate togglait dans les deux sens).
      run(setBookingValidatedAction(bk.id, service.id, !bk.validated));
      return true;
    }
    if (pointageMode && mode === "realweek") {
      // Cycle présent → absent → effacé.
      const next: Pointage = !bk.pointage ? "present" : bk.pointage === "present" ? "absent" : null;
      run(setBookingPointageAction(bk.id, service.id, next));
      return true;
    }
    return false;
  }

  // Impression N&B (bw=true) ou couleur : ouvre une fenêtre dédiée avec la seule grille.
  function printAgenda(bw: boolean) {
    if (typeof window === "undefined") return;
    const grid = document.getElementById("agenda-print-grid");
    if (!grid) {
      window.alert("Rien à imprimer.");
      return;
    }
    const titleParts = [service.label];
    if (mode === "model") {
      const p = periods[periodIdx];
      if (p) titleParts.push(p.label);
    } else if (mondayStr) {
      titleParts.push(
        `${shortDateFmt.format(addDays(mondayStr, 0))} → ${shortDateFmt.format(addDays(mondayStr, 6))}`,
      );
    }
    const titleStr = titleParts.filter(Boolean).join(" — ") || "Agenda";
    const clone = grid.cloneNode(true) as HTMLElement;
    for (const n of clone.querySelectorAll(".agenda-empty-overlay")) n.remove();
    const win = window.open("", "_blank", "width=1100,height=800");
    if (!win) {
      window.alert("Veuillez autoriser les pop-ups pour imprimer.");
      return;
    }
    const bwCss = bw
      ? "*{color:#000 !important;background:#fff !important;border-color:#999 !important}.agenda-block,.planning-name-tag{border:1px solid #333 !important}"
      : "";
    win.document.write(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${titleStr}</title><style>${PRINT_CSS}${bwCss}</style></head><body><h1>${titleStr}</h1>${clone.outerHTML}</body></html>`,
    );
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  // Restaure la vue (exercice / période / semaine) depuis sessionStorage au montage,
  // pour revenir sur la sélection précédente quand on rouvre la page. À défaut, ancre
  // la semaine réelle sur le lundi courant. (Client uniquement → pas de mismatch SSR.)
  const persistSkip = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: restauration au montage uniquement
  useEffect(() => {
    let anchored = false;
    try {
      const raw = sessionStorage.getItem(`agenda-admin-view:${service.id}`);
      if (raw) {
        const v = JSON.parse(raw) as Partial<{
          exerciceId: number | null;
          periodIdx: number;
          anchorMonday: string;
          weekAB: "A" | "B";
        }>;
        // Ne restaure l'exercice que s'il existe encore (sinon défaut).
        if (v.exerciceId == null || exercices.some((e) => e.id === v.exerciceId)) {
          if (v.exerciceId !== undefined) setCurrentExerciceId(v.exerciceId);
        }
        if (typeof v.periodIdx === "number" && v.periodIdx >= 0) setPeriodIdx(v.periodIdx);
        if (v.weekAB === "A" || v.weekAB === "B") setWeekAB(v.weekAB);
        if (typeof v.anchorMonday === "string") {
          setAnchorMonday(v.anchorMonday);
          anchored = true;
        }
      }
    } catch {}
    if (!anchored) setAnchorMonday(ymd(mondayOf(new Date())));
  }, []);

  // Persiste la vue à chaque changement. On saute le tout 1er run (montage, AVANT que
  // la restauration ci-dessus n'ait été appliquée) pour ne pas écraser la valeur
  // stockée avec les valeurs par défaut.
  useEffect(() => {
    if (persistSkip.current) {
      persistSkip.current = false;
      return;
    }
    try {
      sessionStorage.setItem(
        `agenda-admin-view:${service.id}`,
        JSON.stringify({ exerciceId: currentExerciceId, periodIdx, anchorMonday, weekAB }),
      );
    } catch {}
  }, [service.id, currentExerciceId, periodIdx, anchorMonday, weekAB]);

  // Le mode pointage n'a de sens qu'en semaine réelle : on le désactive si on
  // repasse en "modèle de période" (cohérent avec le legacy).
  useEffect(() => {
    if (mode !== "realweek" && pointageMode) setPointageMode(false);
  }, [mode, pointageMode]);

  // Verrouille la période active en semaine réelle : dès qu'une période est
  // dérivée pour la semaine courante, on la fige dans rwPeriodId. La nav ◀/▶
  // s'appuie alors sur cette période figée (et non sur une re-dérivation qui
  // basculerait sur la voisine aux frontières). Re-verrouille si l'ancien verrou
  // ne couvre plus la semaine (ex. après « Aujourd'hui »). Cf. legacy l.6481-6490.
  useEffect(() => {
    if (mode !== "realweek") return;
    if (coveringPeriod && coveringPeriod.id !== rwPeriodId) setRwPeriodId(coveringPeriod.id);
    else if (!coveringPeriod && rwPeriodId !== null) setRwPeriodId(null);
  }, [mode, coveringPeriod, rwPeriodId]);

  function openCreate(dayKey: string, slotId: string, ponctuel = false, slotDate?: string) {
    setCUser("");
    setCEnfants("0");
    setCTheme("");
    setCError(null);
    setCreateCtx({ dayKey, slotId, ponctuel, slotDate });
  }

  function submitCreate() {
    if (!createCtx) return;
    if (!cUser) {
      setCError("Choisissez un usager.");
      return;
    }
    // Créneau ponctuel : réservation ponctuelle (pas de période ni de jour).
    if (createCtx.ponctuel) {
      const slotId = createCtx.slotId;
      startTransition(async () => {
        const res = await createUniqueBookingAction({
          serviceId: service.id,
          slotId,
          userId: cUser,
          enfants: Number(cEnfants) || 0,
          theme: cTheme,
        });
        if (!res.ok) {
          setCError(res.error ?? "Échec.");
          return;
        }
        setCreateCtx(null);
        router.refresh();
      });
      return;
    }
    const createPeriodId =
      effectivePeriodId != null && effectivePeriodId > 0 ? effectivePeriodId : null;
    if (createPeriodId == null) {
      setCError("Aucune période active pour créer une réservation.");
      return;
    }
    startTransition(async () => {
      const res = await createRecurringBookingAction({
        serviceId: service.id,
        slotId: createCtx.slotId,
        periodId: createPeriodId,
        dayKey: createCtx.dayKey,
        userId: cUser,
        enfants: Number(cEnfants) || 0,
        theme: cTheme,
        week: effectiveWeek ?? "",
      });
      if (!res.ok) {
        setCError(res.error ?? "Échec.");
        return;
      }
      setCreateCtx(null);
      router.refresh();
    });
  }

  const createSlot = createCtx
    ? (slots.find((s) => s.id === createCtx.slotId) ??
      uniqueSlots.find((s) => s.id === createCtx.slotId) ??
      null)
    : null;

  // Bloc de la pile ouverte, recalculé en direct (reste à jour après refresh ;
  // se referme tout seul si le créneau n'a plus de réservation).
  const stackBlock = stackKey
    ? (blocksByDay[stackKey.dayKey]?.find((bl) => bl.slotId === stackKey.slotId) ?? null)
    : null;
  const stackSlot = stackKey
    ? (slots.find((s) => s.id === stackKey.slotId) ??
      uniqueSlots.find((s) => s.id === stackKey.slotId) ??
      null)
    : null;

  // Rendu d'UN bloc-créneau (timed ou journée entière), réutilisé par la grille
  // horaire et par la bande « Journée entière » (port du legacy
  // _renderAgendaAdminBlock(b, isAlldayBlock)). En all-day : pas de positionnement
  // absolu (le CSS .agenda-block.is-allday gère position/​taille dans la cellule).
  const renderBlock = (b: Block, allday: boolean) => {
    const pct = Math.min(100, b.capacity > 0 ? (b.used / b.capacity) * 100 : 0);
    // Couleur du compteur de places (barre de jauge ET texte X/Y) selon le
    // remplissage, 3 paliers (mêmes seuils que la jauge de la modale pile) :
    // vert < 70 %, orange ≥ 70 %, rouge à 100 %. Indépendant de la couleur du
    // créneau (jaune/vert), qui ne varie plus.
    const fillColor = pct >= 100 ? "var(--danger)" : pct >= 70 ? "#e8a45a" : "var(--accent)";
    const posStyle: React.CSSProperties = allday
      ? {}
      : (() => {
          // top/height dérivés des minutes via mapMinToY (compactage pause).
          // Bornage à la plage visible + 2px de gap haut/bas (cf. legacy).
          const ys = mapMinToY(Math.max(b.startMin, gridStartMin));
          const ye = mapMinToY(Math.min(b.endMin, gridEndMin));
          return {
            top: ys + 2,
            height: Math.max(28, ye - ys - 4),
            left: `calc(${b.leftPct}% + 2px)`,
            width: `calc(${b.widthPct}% - 4px)`,
          };
        })();
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: bloc-créneau agenda (clic = créer)
      <div
        key={`${b.dayKey}|${b.slotId}`}
        // 2 couleurs fixes, sans variation selon le remplissage/jauge : vert pour
        // les ponctuels autonomes, jaune (défaut .agenda-block) pour les récurrents
        // et leurs miroirs (cf. légende Récurrent/Ponctuel).
        className={`agenda-block${allday ? " is-allday" : ""}`}
        style={{
          ...posStyle,
          // Centrage vertical des badges dans le créneau (inline = priorité
          // sur les feuilles concurrentes GRID_CSS / app-legacy.css).
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          // Ponctuel autonome (non miroir) → vert distinctif, valeurs
          // exactes du legacy (.agenda-block.is-uniq : --slot-uniq-color =
          // var(--accent), fond = color-mix 25 % accent / transparent).
          ...(uniqueIdSet.has(b.slotId)
            ? {
                background: "color-mix(in srgb, var(--accent) 25%, transparent)",
                borderColor: "var(--accent)",
              }
            : {}),
        }}
        onClick={(e) => {
          // Clic sur la zone vide du créneau → nouvelle réservation.
          e.stopPropagation();
          // Créneau ponctuel : ouvre la création d'une réservation ponctuelle.
          if (uniqueIdSet.has(b.slotId)) {
            const u = uniqueSlots.find((s) => s.id === b.slotId);
            openCreate(b.dayKey, b.slotId, true, u?.slotDate);
            return;
          }
          if (effectivePeriodId != null && effectivePeriodId > 0) openCreate(b.dayKey, b.slotId);
        }}
        onDragOver={(e) => {
          if (draggingId != null && !uniqueIdSet.has(b.slotId)) e.preventDefault();
        }}
        onDrop={(e) => {
          // Le créneau est la cible de drop : déplace la résa glissée ici.
          e.preventDefault();
          e.stopPropagation();
          if (draggingId == null) return;
          const id = draggingId;
          setDraggingId(null);
          if (uniqueIdSet.has(b.slotId)) return;
          run(moveBookingAction(id, service.id, b.dayKey, b.slotId));
        }}
      >
        {/* Badges centrés via le parent .agenda-block (justify-content:center).
          Le chips ne grandit pas pour que le centrage opère ; la jauge est
          sortie du flux (position absolue en bas). */}
        <div
          className="agenda-block-chips"
          style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 2 }}
        >
          {b.bookings.length === 0 && (
            // Créneau vide : repère discret (horaire + « + »), bloc cliquable
            // (le clic sur le bloc ouvre la création — cf. onClick parent).
            <div
              className="agenda-block-empty"
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                color: "var(--muted)",
                fontSize: ".62rem",
                fontWeight: 600,
                opacity: 0.7,
              }}
            >
              <span className="agenda-block-empty-time">
                {slots.find((s) => s.id === b.slotId)?.startTime ??
                  uniqueSlots.find((s) => s.id === b.slotId)?.startTime ??
                  ""}
              </span>
              <span className="agenda-block-empty-plus" style={{ fontSize: ".8rem" }}>
                +
              </span>
            </div>
          )}
          {/* ≥2 réservations → pile de badges (legacy .planning-stack-wrap) :
            jusqu'à 3 badges superposés + compteur ; clic = modale liste. */}
          {b.bookings.length >= 2 && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: pile (clic = liste des réservations)
            <div
              className="planning-stack-wrap"
              title={`${b.bookings.length} réservations — cliquer pour voir la liste`}
              onClick={(e) => {
                e.stopPropagation();
                setStackKey({ slotId: b.slotId, dayKey: b.dayKey });
              }}
            >
              {(
                [
                  ...(b.bookings[2] ? [{ bk: b.bookings[2], cls: "stack-back2" }] : []),
                  ...(b.bookings[1] ? [{ bk: b.bookings[1], cls: "stack-back" }] : []),
                  { bk: b.bookings[0], cls: "stack-front" },
                ] as { bk: Booking; cls: string }[]
              ).map(({ bk, cls }) => (
                <div key={cls} className={cls}>
                  <div
                    className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}`}
                    style={{ ...badgeStyle(bk.validated), position: "relative" }}
                  >
                    {/* La pastille P/A doit aussi apparaître sur les badges
                        de la pile (cf. legacy), pas seulement dans la modale. */}
                    <PointagePill pointage={bk.pointage} />
                    {(bk.structure || bk.demandeur) && (
                      <span style={{ fontWeight: 700 }}>{bk.structure || bk.demandeur}</span>
                    )}
                    <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>{bk.name}</span>
                    {modes.themeMode && bk.theme && (
                      <span
                        style={{
                          fontSize: ".62rem",
                          fontWeight: 600,
                          color: bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)",
                        }}
                      >
                        {bk.theme}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <span className="planning-stack-count">{b.bookings.length}</span>
            </div>
          )}
          {b.bookings.length < 2 &&
            b.bookings.map((bk) => {
              const pendingValidation = validation && !bk.validated;
              const quickActive = pendingValidation || (pointageMode && mode === "realweek");
              // Legacy : ligne1 = structure sinon catégorie (demandeur),
              // ligne2 = NOM Prénom, ligne3 = thème (si présent).
              const primaryLabel = bk.structure || bk.demandeur;
              const accentColor = bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)";
              // Réservation pointée → verrouillée : plus déplaçable
              // (cf. legacy isLockedBadge → draggable=false).
              const locked = bk.pointage != null;
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: badge (clic = valider/pointer/éditer)
                <div
                  key={bk.id}
                  className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${locked ? " is-locked" : ""}`}
                  draggable={!locked}
                  style={{
                    ...badgeStyle(bk.validated),
                    position: "relative",
                    opacity: draggingId === bk.id ? 0.4 : 1,
                    cursor: quickActive ? "pointer" : locked ? "default" : "grab",
                  }}
                  title={`${bk.demandeur} — ${bk.name}`}
                  onDragStart={
                    locked
                      ? undefined
                      : (e) => {
                          e.stopPropagation();
                          setDraggingId(bk.id);
                        }
                  }
                  onDragEnd={locked ? undefined : () => setDraggingId(null)}
                  onClick={(e) => {
                    // Le badge porte les actions sur la réservation (cf. legacy).
                    // Validation/pointage ON = clic rapide ; sinon = modale d'édition.
                    e.stopPropagation();
                    if (onBlockQuickAction(bk)) return;
                    setDetail({ booking: bk });
                  }}
                >
                  <PointagePill pointage={bk.pointage} />
                  {primaryLabel && <span style={{ fontWeight: 700 }}>{primaryLabel}</span>}
                  <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>{bk.name}</span>
                  {modes.themeMode && bk.theme && (
                    <span style={{ fontSize: ".62rem", fontWeight: 600, color: accentColor }}>
                      {bk.theme}
                    </span>
                  )}
                </div>
              );
            })}
        </div>
        {/* Mode jauge ON → barre + used/cap ; mode jauge OFF → simple
          compteur places occupées/total (format 1/15). */}
        {b.bookings.length > 0 &&
          (modes.gaugeRec ? (
            <div
              className="agenda-block-meta is-gauge"
              style={{
                position: "absolute",
                bottom: 1,
                left: 4,
                display: "flex",
                alignItems: "center",
                gap: 3,
                // Barre + texte X/Y colorés selon le remplissage (rouge si complet).
                color: fillColor,
              }}
            >
              <span className="agenda-block-gauge-bar">
                <span style={{ width: `${pct}%`, background: fillColor }} />
              </span>
              {b.used}/{b.capacity}
            </div>
          ) : (
            <div
              className="agenda-block-meta"
              style={{ position: "absolute", bottom: 1, left: 4, color: fillColor }}
            >
              {b.used}/{b.capacity}
            </div>
          ))}
      </div>
    );
  };

  return (
    <div id="tab-content-agenda">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Agenda
          {exercices.length > 0 && (
            <span className="exercice-nav-inline">
              <span className="ex-nav-label">{exLabel}</span>
              <span className="ex-nav-arrows">
                <button
                  type="button"
                  className="ex-arrow"
                  aria-label="Exercice précédent"
                  disabled={!canExPrev}
                  onClick={() => canExPrev && gotoExercice(exercices[exIdx - 1].id)}
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="ex-arrow"
                  aria-label="Exercice suivant"
                  disabled={!canExNext}
                  onClick={() => canExNext && gotoExercice(exercices[exIdx + 1].id)}
                >
                  ▶
                </button>
              </span>
            </span>
          )}
        </div>
        {/* Navigation semaine (Semaine réelle) : centrée sur la même ligne que le
            titre et le sélecteur. */}
        {mode === "realweek" && (
          <div className="periode-nav" style={{ margin: "0 auto" }}>
            <button
              type="button"
              className="ex-arrow"
              disabled={!canWeekPrev}
              onClick={() => canWeekPrev && shiftWeek(-1)}
            >
              ◀
            </button>
            <span className="ex-nav-label">
              {mondayStr
                ? `${shortDateFmt.format(addDays(mondayStr, 0))} → ${shortDateFmt.format(addDays(mondayStr, 6))}`
                : "…"}
            </span>
            <button
              type="button"
              className="ex-arrow"
              disabled={!canWeekNext}
              onClick={() => canWeekNext && shiftWeek(1)}
            >
              ▶
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: ".05rem .45rem", fontSize: ".64rem", marginLeft: ".4rem" }}
              onClick={() => {
                // Retour à la semaine courante : on relâche le verrou pour
                // re-dériver la période qui couvre aujourd'hui.
                setRwPeriodId(null);
                setAnchorMonday(ymd(mondayOf(new Date())));
              }}
            >
              Aujourd&apos;hui
            </button>
          </div>
        )}
        {/* Sélecteurs empilés (cf. legacy .agenda-mode-toggles-wrap, colonne,
            alignés à droite) : Modèle/Semaine réelle, puis EN DESSOUS le toggle
            Semaine A/B en mode modèle, ou l'indicateur de semaine en semaine réelle. */}
        <div className="agenda-mode-toggles-wrap">
          <div className="agenda-mode-toggle" role="tablist" aria-label="Mode d&apos;affichage">
            <button
              type="button"
              className={`agenda-mode-btn${mode === "model" ? " active" : ""}`}
              onClick={() => setMode("model")}
            >
              Modèle de période
            </button>
            <button
              type="button"
              className={`agenda-mode-btn${mode === "realweek" ? " active" : ""}`}
              onClick={() => setMode("realweek")}
            >
              Semaine réelle
            </button>
          </div>
          {abMode && mode === "model" && (
            <div className="agenda-mode-toggle" aria-label="Semaine A ou B">
              <button
                type="button"
                className={`agenda-mode-btn${weekAB === "A" ? " active" : ""}`}
                onClick={() => setWeekAB("A")}
              >
                Semaine A
              </button>
              <button
                type="button"
                className={`agenda-mode-btn${weekAB === "B" ? " active" : ""}`}
                onClick={() => setWeekAB("B")}
              >
                Semaine B
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: ".5rem",
        }}
      >
        <div className="period-tabs" id="agenda-period-tabs">
          {visiblePeriods.map((p, i) => {
            const active = mode === "realweek" ? p.id === coveringPeriod?.id : i === periodIdx;
            return (
              <button
                key={p.id}
                type="button"
                className={`period-btn ${active ? "active" : ""}`}
                style={{ "--period-color": p.color } as React.CSSProperties}
                onClick={() => {
                  if (mode === "realweek") {
                    // Onglet choisi = source de vérité : on fige la période ET on
                    // ancre la semaine sur son début (cf. legacy _pickedP).
                    if (p.dateStart) {
                      setRwPeriodId(p.id);
                      setAnchorMonday(ymd(mondayOf(new Date(`${p.dateStart}T00:00:00`))));
                    }
                  } else {
                    setPeriodIdx(i);
                  }
                }}
              >
                <span className="period-badge" />
                {p.label}
              </button>
            );
          })}
          {periods.length === 0 && (
            <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              Aucune période active.
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div
            className="planning-options-row"
            style={{ flexDirection: "column", alignItems: "flex-end", gap: 1, lineHeight: 1.1 }}
          >
            <label className="planning-option">
              Masquer les horaires sans réservation
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
              />
            </label>
            <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
              <label className="planning-option">
                Mode validation
                <input
                  type="checkbox"
                  checked={validation}
                  onChange={(e) => toggleValidation(e.target.checked)}
                />
              </label>
              {mode === "realweek" && (
                <label className="planning-option">
                  Mode pointage
                  <input
                    type="checkbox"
                    checked={pointageMode}
                    onChange={(e) => togglePointageMode(e.target.checked)}
                  />
                </label>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <button
              type="button"
              onClick={() => printAgenda(true)}
              title="Imprimer en noir & blanc"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                padding: ".28rem .38rem",
                cursor: "pointer",
                color: "var(--muted)",
                display: "flex",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <title>Imprimer N&amp;B</title>
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => printAgenda(false)}
              title="Imprimer en couleur"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                padding: ".28rem .38rem",
                cursor: "pointer",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                lineHeight: 1,
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <title>Imprimer couleur</title>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" />
                <rect x="6" y="14" width="12" height="8" rx="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="planning-wrap" id="agenda-print-grid">
        <div
          className={`agenda-grid${mode === "realweek" ? " is-realweek" : ""}`}
          style={{ gridTemplateColumns: `44px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {/* En semaine réelle + mode A/B : grosse lettre A/B de la semaine courante
              dans le coin haut-gauche (cf. legacy cornerAB). Sinon, l'horloge. */}
          <div
            className="agenda-header-cell agenda-corner"
            title={
              abMode && mode === "realweek" && realWeekParity
                ? `Semaine ${realWeekParity}`
                : "Horaires"
            }
          >
            {abMode && mode === "realweek" && realWeekParity ? realWeekParity : "🕘"}
          </div>
          {days.map((d) => (
            <div key={d} className={`agenda-header-cell${outOfPeriodCls(d)}`}>
              {DAY_NAMES[d] ?? d}
              {mode === "realweek" && weekDateByDay[d] && (
                <span className="agenda-day-sub">{weekDateByDay[d]}</span>
              )}
            </div>
          ))}

          {/* Bande « Journée entière » : créneaux sans horaire, au-dessus de la
              grille horaire (port du legacy alldayRow). Masquée s'il n'y a aucun
              bloc all-day — en hideEmpty, on ne compte que ceux qui ont une résa. */}
          {days.some((d) =>
            (blocksByDay[d] ?? []).some((b) => b.isAllDay && (!hideEmpty || b.bookings.length > 0)),
          ) && (
            <>
              <div className="agenda-header-cell agenda-allday-corner" title="Journée entière">
                Journée entière
              </div>
              {days.map((d) => (
                <div key={`ad-${d}`} className={`agenda-allday-cell${outOfPeriodCls(d)}`}>
                  {(blocksByDay[d] ?? [])
                    .filter((b) => b.isAllDay && (!hideEmpty || b.bookings.length > 0))
                    .map((b) => renderBlock(b, true))}
                </div>
              ))}
            </>
          )}

          <div className="agenda-time-col" style={{ height: totalH }}>
            {(() => {
              // On masque l'heure si son quart pile (h:00) est dans la pause compactée.
              const visibleHours = hours.filter((h) => h * 60 >= gridEndMin || qIdx.has(h * 60));
              return visibleHours.map((h, i) => {
                // Première heure : poussée sous sa ligne (is-break-start) ; dernière :
                // remontée au-dessus de sa ligne (is-break-end) pour rester dans la colonne.
                const edge =
                  i === 0
                    ? " is-break-start"
                    : i === visibleHours.length - 1
                      ? " is-break-end"
                      : "";
                return (
                  <div
                    key={h}
                    className={`agenda-time-mark${edge}`}
                    style={{ top: mapMinToY(h * 60) }}
                  >
                    {String(h).padStart(2, "0")}:00
                  </div>
                );
              });
            })()}
          </div>

          {days.map((d) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: grille agenda (clic = créer)
            <div
              key={d}
              className={`agenda-day-col${outOfPeriodCls(d)}`}
              // Jour fermé : on neutralise toute interaction (clic créer, drag/drop)
              // sur la colonne ET tout son contenu (blocs/badges) via pointer-events.
              style={{
                height: totalH,
                cursor: isDayDisabled(d) ? "not-allowed" : "cell",
                pointerEvents: isDayDisabled(d) ? "none" : undefined,
              }}
              onClick={(e) => {
                if (isDayDisabled(d)) return;
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                if (slot && effectivePeriodId != null && effectivePeriodId > 0)
                  openCreate(d, slot.id);
              }}
              onDragOver={(e) => {
                if (isDayDisabled(d)) return;
                if (draggingId != null) e.preventDefault();
              }}
              onDrop={(e) => {
                if (isDayDisabled(d)) return;
                e.preventDefault();
                if (draggingId == null) return;
                const slot = slotAtClientY(e.currentTarget.getBoundingClientRect().top, e.clientY);
                const id = draggingId;
                setDraggingId(null);
                if (slot) run(moveBookingAction(id, service.id, d, slot.id));
              }}
            >
              {/* Lignes de grille sur les quarts VISIBLES (compactage pause) :
                  pointillé fin par quart, trait plein (is-hour) sur l'heure pleine. */}
              {quarters.map((min) => {
                const isHour = min % 60 === 0;
                return (
                  <div
                    key={min}
                    className={`agenda-grid-line${isHour ? " is-hour" : ""}`}
                    style={{ top: mapMinToY(min) }}
                  />
                );
              })}
              {/* Bande grise « pause méridienne » (top/height via le mapping ;
                  disparaît si la pause tombe entièrement dans une zone masquée). */}
              {hasLunch &&
                (() => {
                  const ltop = mapMinToY(lunchStart);
                  const lh = mapMinToY(lunchEnd) - ltop;
                  return lh > 0 ? (
                    <div className="agenda-lunch-band" style={{ top: ltop, height: lh }} />
                  ) : null;
                })()}
              {(blocksByDay[d] ?? [])
                // Grille horaire : uniquement les créneaux datés (les « journée
                // entière » sont rendus dans la bande dédiée en haut). hideEmpty
                // masque les créneaux vides pour ne pas écraser la grille (cf. legacy).
                .filter((b) => !b.isAllDay && (!hideEmpty || b.bookings.length > 0))
                .map((b) => renderBlock(b, false))}
            </div>
          ))}
        </div>
      </div>

      {/* Sous le tableau : astuce à gauche, légende complète à droite (reprise du
          legacy #agenda-legend-realweek). La légende n'a de sens qu'en « Semaine
          réelle » (pointage P/A + créneaux ponctuels datés). */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
          marginTop: ".6rem",
        }}
      >
        {/* flex:1 + minWidth:0 → l'astuce absorbe le rétrécissement en passant à la
            ligne au lieu de déborder ; la légende garde sa place (flexShrink:0). */}
        <p
          style={{
            fontSize: ".7rem",
            color: "var(--muted)",
            margin: 0,
            flex: "1 1 0%",
            minWidth: 0,
          }}
        >
          Astuce : cliquez sur un créneau vide pour ajouter une réservation, ou glissez un bloc vers
          un autre créneau pour le déplacer.
        </p>
        {mode === "realweek" && (
          <div className="agenda-legend" style={{ flexShrink: 0 }}>
            <span className="agenda-legend-item">
              <span className="agenda-legend-swatch is-rec" />
              Récurrent
            </span>
            <span className="agenda-legend-item">
              <span className="agenda-legend-swatch is-uniq" />
              Ponctuel
            </span>
            <span className="agenda-legend-item">
              <span className="indic_p">P</span>
              Présent
            </span>
            <span className="agenda-legend-item">
              <span className="indic_a">A</span>
              Absent
            </span>
          </div>
        )}
      </div>

      {stackKey && stackBlock && (
        <ModalOverlay onClose={() => setStackKey(null)}>
          {(() => {
            // Modale "pile" stylée comme le legacy (cell-stack-modal) : pastille
            // date/jour, sous-titre horaire, bascules validation/pointage, mini-grille
            // horaire (csm-time-col + bloc créneau coloré csm-slot-block) contenant la
            // liste des badges (cell-stack-list), puis bandeau capacité.
            const isPonctuel = uniqueIdSet.has(stackKey.slotId);
            const uSlot = uniqueSlots.find((s) => s.id === stackKey.slotId);
            const ponctDate =
              isPonctuel && uSlot?.slotDate
                ? new Date(`${uSlot.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "";
            const period = periods.find((p) => p.id === effectivePeriodId);
            // Pastille : libellé de période (récurrent) ou date (ponctuel), cf. legacy.
            const pillLabel = isPonctuel ? ponctDate : (period?.label ?? "");
            const dayLabel = DAY_NAMES[stackKey.dayKey] ?? stackKey.dayKey;
            // Jauge = somme enfants + adultes / capacité (legacy _renderCsmCapInfo).
            const gaugeSum = stackBlock.bookings.reduce(
              (s, bk) => s + bk.enfants + bk.accompagnants,
              0,
            );
            const gaugeTotal = stackBlock.capacity;
            const gaugePct =
              gaugeTotal > 0 ? Math.min(100, Math.round((gaugeSum / gaugeTotal) * 100)) : 0;
            const gaugeColor =
              gaugePct >= 100 ? "var(--danger)" : gaugePct >= 70 ? "#e8a45a" : "var(--accent)";
            const showGauge = isPonctuel ? modes.gaugePonct : modes.gaugeRec;
            const sMin = stackSlot ? toMinutes(stackSlot.startTime, 0) : 0;
            const eMin = stackSlot ? toMinutes(stackSlot.endTime, sMin + 60) : sMin + 60;
            const hasRange = eMin > sMin;
            const pxPerMinModal = 24 / 15; // 24 px par quart d'heure (legacy)
            const blockMinH = hasRange ? Math.max(56, (eMin - sMin) * pxPerMinModal) : 56;
            const marks: number[] = [];
            if (hasRange) for (let m = sMin; m <= eMin; m += 15) marks.push(m);
            return (
              <>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setStackKey(null)}
                  aria-label="Fermer"
                >
                  ×
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap",
                    marginBottom: ".6rem",
                    paddingRight: "1.5rem",
                  }}
                >
                  {/* Gauche : pastille période/date + horaire (jour) sur la même ligne. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: ".6rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className={`period-btn active${isPonctuel ? " is-uniq" : ""}`}
                      style={{
                        cursor: "default",
                        padding: ".12rem .5rem",
                        fontSize: ".64rem",
                        gap: ".3rem",
                        textTransform: "capitalize",
                      }}
                    >
                      <span className="period-badge" />
                      {pillLabel}
                    </span>
                    <span className="panel-subtitle" style={{ margin: 0 }}>
                      {isPonctuel
                        ? stackSlot
                          ? `${stackSlot.startTime} – ${stackSlot.endTime}`
                          : ""
                        : `${dayLabel}${stackSlot ? ` · ${stackSlot.startTime} – ${stackSlot.endTime}` : ""}`}
                    </span>
                  </div>
                  {/* Droite : bascules. « Mode validation » est toujours affiché ;
                      « Mode pointage » seulement en « Semaine réelle » (le pointage n'a
                      de sens que sur une semaine datée — cf. legacy). La croix de
                      fermeture est positionnée en haut à droite de la modale (modal-close). */}
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}
                  >
                    <label className="planning-option" style={{ margin: 0 }}>
                      Mode validation{" "}
                      <input
                        type="checkbox"
                        checked={validation}
                        onChange={(e) => toggleValidation(e.target.checked)}
                      />
                    </label>
                    {mode === "realweek" && (
                      <label className="planning-option" style={{ margin: 0 }}>
                        Mode pointage{" "}
                        <input
                          type="checkbox"
                          checked={pointageMode}
                          onChange={(e) => togglePointageMode(e.target.checked)}
                        />
                      </label>
                    )}
                  </div>
                </div>
                <div className="csm-grid-wrap">
                  <div className="csm-time-col" style={{ height: blockMinH }}>
                    {marks.map((m) => (
                      <div
                        key={m}
                        className="csm-time-mark"
                        style={{ top: (m - sMin) * pxPerMinModal }}
                      >
                        {`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`}
                      </div>
                    ))}
                  </div>
                  <div
                    className={`csm-slot-block${isPonctuel ? " is-uniq" : ""}`}
                    style={
                      {
                        minHeight: blockMinH,
                        "--quarter-h": "24px",
                        "--hour-h": "96px",
                      } as React.CSSProperties
                    }
                  >
                    <div className="cell-stack-list">
                      {stackBlock.bookings.map((bk) => (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: ligne réservation (clic = éditer)
                        <div
                          key={bk.id}
                          className={`planning-name-tag ${bk.validated ? "is-validated" : "is-pending"}${bk.pointage != null ? " is-locked" : ""}`}
                          // Glisser-déplacer depuis la pile : sauf si pointée (verrouillée).
                          draggable={bk.pointage == null}
                          style={{
                            ...badgeStyle(bk.validated),
                            cursor: bk.pointage == null ? "grab" : "default",
                            position: "relative",
                            opacity: draggingId === bk.id ? 0.4 : 1,
                          }}
                          title={`${bk.demandeur} — ${bk.name}`}
                          onDragStart={
                            bk.pointage != null
                              ? undefined
                              : (e) => {
                                  // On amorce le drag, PUIS on ferme la pile au tick suivant
                                  // pour libérer la grille comme cible de dépôt (port legacy
                                  // _onDragStartFromStackModal).
                                  e.stopPropagation();
                                  setDraggingId(bk.id);
                                  setTimeout(() => setStackKey(null), 0);
                                }
                          }
                          onDragEnd={bk.pointage != null ? undefined : () => setDraggingId(null)}
                          onClick={() => {
                            if (onBlockQuickAction(bk)) return;
                            // On garde la pile ouverte : la modale détail s'empile
                            // par-dessus, et sa fermeture y ramène.
                            setDetail({ booking: bk });
                          }}
                        >
                          <PointagePill pointage={bk.pointage} />
                          {/* Réservation pointée → verrouillée : pas de suppression
                              rapide (cf. legacy isLockedBadge, croix masquée). */}
                          {bk.pointage == null && (
                            <button
                              type="button"
                              className="planning-name-tag-close"
                              title="Supprimer"
                              style={{
                                position: "absolute",
                                top: 1,
                                right: 3,
                                border: "none",
                                background: "transparent",
                                color: "inherit",
                                cursor: "pointer",
                                fontSize: ".8rem",
                                lineHeight: 1,
                                padding: 0,
                                opacity: 0.6,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                run(deleteBookingAdminAction(bk.id, service.id));
                              }}
                            >
                              ×
                            </button>
                          )}
                          {(bk.structure || bk.demandeur) && (
                            <span style={{ fontWeight: 700 }}>{bk.structure || bk.demandeur}</span>
                          )}
                          <span style={{ fontSize: ".65rem", color: "var(--muted)" }}>
                            {bk.name}
                          </span>
                          {modes.themeMode && bk.theme && (
                            <span
                              style={{
                                fontSize: ".62rem",
                                fontWeight: 600,
                                color: bk.validated ? "var(--accent)" : "rgba(232, 164, 90, .95)",
                              }}
                            >
                              {bk.theme}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div id="csm-cap-info">
                  {showGauge ? (
                    <span className="csm-gauge-info">
                      <span>Jauge</span>
                      <span
                        style={{
                          display: "inline-block",
                          width: 80,
                          height: 6,
                          borderRadius: 3,
                          background: "rgba(0,0,0,.18)",
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            height: "100%",
                            width: `${gaugePct}%`,
                            background: gaugeColor,
                          }}
                        />
                      </span>
                      <span>
                        {gaugeSum}/{gaugeTotal}
                      </span>
                    </span>
                  ) : (
                    <span>
                      {stackBlock.used}/{stackBlock.capacity}
                    </span>
                  )}
                </div>
              </>
            );
          })()}
        </ModalOverlay>
      )}

      {/* Modale détail : rendue APRÈS la pile pour s'empiler par-dessus.
          Sa fermeture laisse stackKey intact → retour à la pile. */}
      {detail && (
        <BookingDetailModal
          booking={detail.booking}
          serviceId={service.id}
          themesMode={service.themesMode}
          themes={themes}
          onClose={() => setDetail(null)}
          onSaved={() => {
            setDetail(null);
            router.refresh();
          }}
          run={run}
        />
      )}

      {createCtx && (
        <ModalOverlay onClose={() => setCreateCtx(null)}>
          <div className="modal-title">
            Nouvelle réservation —{" "}
            {createCtx.ponctuel
              ? createCtx.slotDate
                ? new Date(`${createCtx.slotDate}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : "créneau ponctuel"
              : (DAY_NAMES[createCtx.dayKey] ?? createCtx.dayKey)}
            {createSlot ? ` · ${createSlot.startTime}–${createSlot.endTime}` : ""}
          </div>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="ag-user">Usager</label>
              <select id="ag-user" value={cUser} onChange={(e) => setCUser(e.target.value)}>
                <option value="">— choisir —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ag-enfants">Enfants</label>
              <input
                id="ag-enfants"
                type="number"
                min={0}
                value={cEnfants}
                onChange={(e) => setCEnfants(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ag-theme">Thème</label>
              <input
                id="ag-theme"
                value={cTheme}
                onChange={(e) => setCTheme(e.target.value)}
                placeholder="(optionnel)"
              />
            </div>
          </div>
          {cError && (
            <p className="field-error" style={{ display: "block" }}>
              {cError}
            </p>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setCreateCtx(null)}>
              Annuler
            </button>
            <button type="button" className="btn btn-primary" onClick={submitCreate}>
              Créer
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/**
 * Overlay de modale : clic sur le fond ou touche Échap = fermeture. Encapsule les
 * handlers clavier/souris pour rester accessible (et éviter de dupliquer les ignores).
 */
function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="modal-overlay open"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <dialog
        open
        className="modal-box"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {children}
      </dialog>
    </div>
  );
}

// Accord pluriel des libellés de compteurs (cf. legacy _bdetUpdateLabels).
function plural(n: number, singular: string, plural: string): string {
  return n > 1 ? plural : singular;
}

/**
 * Modale d'édition « 📋 Réservation » (port du legacy `#booking-detail-modal`).
 * - Demandeur en lecture seule.
 * - Participants : 2 compteurs (Enfants + Adultes/Accompagnants).
 * - Thème : champ libre (themesMode "libre") ou <select> (themesMode "liste").
 * - Verrou : une réservation pointée n'est pas modifiable (édition désactivée),
 *   mais les actions secondaires (pointage / suppression) restent accessibles.
 */
function BookingDetailModal({
  booking,
  serviceId,
  themesMode,
  themes,
  onClose,
  onSaved,
  run,
}: {
  booking: Booking;
  serviceId: string;
  themesMode: "libre" | "liste";
  themes: string[];
  onClose: () => void;
  onSaved: () => void;
  run: (p: Promise<unknown>) => void;
}) {
  const [, startTransition] = useTransition();
  const [enfants, setEnfants] = useState(String(booking.enfants));
  const [accompagnants, setAccompagnants] = useState(String(booking.accompagnants));
  const [theme, setTheme] = useState(booking.theme);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = booking.pointage != null;
  // Le champ thème n'apparaît que si le service est en mode thèmes (liste) OU si la
  // réservation a déjà un thème non vide (rester fidèle au legacy sans le masquer à tort).
  const showTheme = themesMode === "liste" || booking.theme.trim() !== "";
  // En mode liste, on garantit que le thème courant figure dans les options.
  const themeOptions =
    themesMode === "liste" && theme && !themes.includes(theme) ? [theme, ...themes] : themes;

  const dirty =
    Number(enfants) !== booking.enfants ||
    Number(accompagnants) !== booking.accompagnants ||
    theme !== booking.theme;

  function reset() {
    setEnfants(String(booking.enfants));
    setAccompagnants(String(booking.accompagnants));
    setTheme(booking.theme);
    setError(null);
  }

  function save() {
    if (!dirty || locked) return;
    setSaving(true);
    setError(null);
    startTransition(async () => {
      const res = await updateBookingDetailAction({
        bookingId: booking.id,
        serviceId,
        enfants: Number(enfants) || 0,
        accompagnants: Number(accompagnants) || 0,
        theme,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error ?? "Échec.");
        return;
      }
      onSaved();
    });
  }

  const nEnf = Number(enfants) || 0;
  const nAcc = Number(accompagnants) || 0;

  return (
    <ModalOverlay onClose={onClose}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      <div className="modal-title">📋 Réservation : {booking.name}</div>

      {locked && (
        <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".2rem 0 .6rem" }}>
          Réservation pointée — édition verrouillée.
        </p>
      )}

      <div className="field full">
        <label htmlFor="bdet-demandeur">Demandeur</label>
        <div className="bdet-readonly" id="bdet-demandeur">
          {booking.demandeur || "—"}
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="bdet-enfants">👶 {plural(nEnf, "Enfant", "Enfants")}</label>
          <input
            id="bdet-enfants"
            type="number"
            min={0}
            max={99}
            value={enfants}
            disabled={locked}
            onChange={(e) => setEnfants(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="bdet-accompagnants">🧑‍🦰 {plural(nAcc, "Adulte", "Adultes")}</label>
          <input
            id="bdet-accompagnants"
            type="number"
            min={0}
            max={99}
            value={accompagnants}
            disabled={locked}
            onChange={(e) => setAccompagnants(e.target.value)}
          />
        </div>
        {showTheme && (
          <div className="field full">
            <label htmlFor="bdet-theme">Thème</label>
            {themesMode === "liste" ? (
              <select
                id="bdet-theme"
                value={theme}
                disabled={locked}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="">— aucun —</option>
                {themeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="bdet-theme"
                value={theme}
                disabled={locked}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="(optionnel)"
              />
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="field-error" style={{ display: "block" }}>
          {error}
        </p>
      )}

      <div className="btn-row">
        {dirty && !locked && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Annuler
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || locked || saving}
          onClick={save}
        >
          💾 Enregistrer
        </button>
      </div>

      {/* Actions secondaires (reprennent l'ancien menu contextuel). */}
      <div
        className="btn-row"
        style={{
          marginTop: ".75rem",
          paddingTop: ".6rem",
          borderTop: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: ".72rem" }}
          disabled={locked}
          onClick={() => run(setBookingValidatedAction(booking.id, serviceId, !booking.validated))}
        >
          {booking.validated ? "↩ Dévalider" : "✓ Valider"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: ".72rem" }}
          onClick={() => run(setBookingPointageAction(booking.id, serviceId, "present"))}
        >
          ✅ Présent
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: ".72rem" }}
          onClick={() => run(setBookingPointageAction(booking.id, serviceId, "absent"))}
        >
          ❌ Absent
        </button>
        {booking.pointage && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: ".72rem" }}
            onClick={() => run(setBookingPointageAction(booking.id, serviceId, null))}
          >
            ⚪ Effacer le pointage
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: ".72rem", color: "var(--danger)", marginLeft: "auto" }}
          onClick={() => {
            if (window.confirm("Supprimer cette réservation ?")) {
              run(deleteBookingAdminAction(booking.id, serviceId));
            }
          }}
        >
          🗑️ Supprimer
        </button>
      </div>
    </ModalOverlay>
  );
}
