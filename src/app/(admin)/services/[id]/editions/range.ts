import { prisma } from "@/server/db";
import type { DatedSession, EditionRow } from "@/server/services/editions";

// Plage de dates partagée par les écrans « Plannings » et « Pointages » : vue
// Hebdomadaire / Mensuelle / par Période (> 1 mois). Tout en UTC (cf. slots /
// listDatedSessions).

export const ymd = (d: Date): string => d.toISOString().slice(0, 10);
export const parseYmd = (s: string): Date => new Date(`${s}T00:00:00Z`);
const reIso = /^\d{4}-\d{2}-\d{2}$/;

function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = lundi
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const monthStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthEnd = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const addMonthsToFirst = (d: Date, n: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const fmtShort = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const fmtMonth = new Intl.DateTimeFormat("fr-FR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const fmtHeading = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** En-tête de section d'une date (« Lundi 22 juin 2026 »). */
export const formatDateHeading = (ymdStr: string): string =>
  cap(fmtHeading.format(parseYmd(ymdStr)));

export type EditionExercice = {
  label: string;
  type: "civile" | "scolaire";
  dateStart: Date | null;
  dateEnd: Date | null;
};

/** Exercice courant (le plus récent) d'un service — base des vues Trimestriel/Annuel. */
export async function fetchCurrentExercice(serviceId: string): Promise<EditionExercice | null> {
  const rows = await prisma.exercice.findMany({
    where: { serviceId },
    select: { label: true, type: true, dateStart: true, dateEnd: true },
  });
  if (rows.length === 0) return null;
  rows.sort((a, b) => {
    const as = a.dateStart?.getTime();
    const bs = b.dateStart?.getTime();
    if (as != null && bs != null) return bs - as;
    if (as != null) return -1;
    if (bs != null) return 1;
    return b.label.localeCompare(a.label);
  });
  return rows[0];
}

/** Exercice sélectionnable dans les Éditions + ids de ses périodes (pour scoper les données). */
export type EditionExerciceOption = EditionExercice & { id: number; periodIds: number[] };

/**
 * Exercices proposés au sélecteur des Éditions et exercice sélectionné.
 * Éligibles = exercices ayant des périodes ACTIVES, + celles DÉSACTIVÉES si le service
 * « affiche les exercices précédents » (même règle que l'agenda). Défaut = le plus récent.
 */
export async function resolveEditionExercice(
  serviceId: string,
  spExercice: string | undefined,
): Promise<{ exercices: { id: number; label: string }[]; selected: EditionExerciceOption | null }> {
  const svc = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { showPreviousExercices: true },
  });
  const states: ("actif" | "desactive")[] = svc?.showPreviousExercices
    ? ["actif", "desactive"]
    : ["actif"];
  const periods = await prisma.period.findMany({
    where: { serviceId, state: { in: states } },
    select: {
      id: true,
      exercice: { select: { id: true, label: true, type: true, dateStart: true, dateEnd: true } },
    },
  });
  const map = new Map<number, EditionExerciceOption>();
  for (const p of periods) {
    const ex = p.exercice;
    if (!ex) continue;
    let e = map.get(ex.id);
    if (!e) {
      e = {
        id: ex.id,
        label: ex.label,
        type: ex.type,
        dateStart: ex.dateStart,
        dateEnd: ex.dateEnd,
        periodIds: [],
      };
      map.set(ex.id, e);
    }
    e.periodIds.push(p.id);
  }
  const list = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  const spId = spExercice ? Number(spExercice) : Number.NaN;
  const selected = list.find((e) => e.id === spId) ?? list[list.length - 1] ?? null;
  return { exercices: list.map((e) => ({ id: e.id, label: e.label })), selected };
}

type Trimestre = { label: string; from: Date; to: Date };
const TRIM_LABELS = ["1er trimestre", "2e trimestre", "3e trimestre", "4e trimestre"];

/**
 * Trimestres d'un exercice selon son type, à partir de l'année de début :
 *   • Scolaire (3) : Sep-Déc · Jan-Mar · Avr-Juin
 *   • Civil    (4) : Jan-Mar · Avr-Juin · Juil-Sep · Oct-Déc
 */
function trimestresFor(type: "civile" | "scolaire", startYear: number): Trimestre[] {
  const tri = (y: number, m0: number, m1: number, i: number): Trimestre => ({
    label: TRIM_LABELS[i],
    from: new Date(Date.UTC(y, m0, 1)),
    to: new Date(Date.UTC(y, m1 + 1, 0)),
  });
  if (type === "scolaire") {
    return [tri(startYear, 8, 11, 0), tri(startYear + 1, 0, 2, 1), tri(startYear + 1, 3, 5, 2)];
  }
  return [
    tri(startYear, 0, 2, 0),
    tri(startYear, 3, 5, 1),
    tri(startYear, 6, 8, 2),
    tri(startYear, 9, 11, 3),
  ];
}

export type RangeMode = "week" | "month" | "trimester" | "year";
export type RangeResult = {
  mode: RangeMode;
  fromYmd: string;
  toYmd: string;
  dateParam: string;
  // Index du trimestre courant (mode "trimester") — conservé pour la pagination.
  trimIndex: number | null;
  // Trimestres de l'exercice (selon son type) — sert aux ruptures de la vue Annuel.
  trimestres: { label: string; fromYmd: string; toYmd: string }[];
  subtitle: string;
  prevHref: string | null;
  nextHref: string | null;
};

/**
 * Résout la plage [from, to] + libellé + navigation à partir des paramètres d'URL
 * (`mode` = week|month|trimester|year, `date`, `trim` ; compat `week`). Les vues
 * Trimestriel/Annuel se calculent sur l'exercice courant (type + dates).
 */
export function resolveRange(
  serviceId: string,
  screen: string,
  sp: { mode?: string; date?: string; week?: string; trim?: string },
  exercice: EditionExercice | null,
  exerciceId?: number | null,
): RangeResult {
  const base = `/services/${serviceId}/editions/${screen}`;
  // Suffixe d'URL conservant l'exercice sélectionné dans les liens de navigation.
  const exq = exerciceId != null ? `&exercice=${exerciceId}` : "";
  // Date de référence : param explicite, sinon aujourd'hui BORNÉ dans l'exercice (la vue
  // reste dans l'exercice même si « aujourd'hui » est hors de ses dates).
  const es = exercice?.dateStart ? ymd(exercice.dateStart) : null;
  const ee = exercice?.dateEnd ? ymd(exercice.dateEnd) : null;
  const todayY = ymd(new Date());
  const fallback = es && todayY < es ? es : ee && todayY > ee ? ee : todayY;
  const dateParam =
    sp.date && reIso.test(sp.date) ? sp.date : sp.week && reIso.test(sp.week) ? sp.week : fallback;
  const ref = parseYmd(dateParam);

  const type = exercice?.type ?? "civile";
  const startYear = exercice?.dateStart
    ? exercice.dateStart.getUTCFullYear()
    : new Date().getUTCFullYear();
  const trimestres = trimestresFor(type, startYear);
  const trimList = trimestres.map((t) => ({
    label: t.label,
    fromYmd: ymd(t.from),
    toYmd: ymd(t.to),
  }));

  // ── Annuel : plage complète de l'exercice (pas de navigation entre exercices) ──
  if (sp.mode === "year") {
    const from = exercice?.dateStart ?? trimestres[0].from;
    const to = exercice?.dateEnd ?? trimestres[trimestres.length - 1].to;
    return {
      mode: "year",
      fromYmd: ymd(from),
      toYmd: ymd(to),
      dateParam,
      trimIndex: null,
      trimestres: trimList,
      subtitle: exercice?.label ?? `du ${fmtShort.format(from)} au ${fmtShort.format(to)}`,
      prevHref: null,
      nextHref: null,
    };
  }

  // ── Trimestriel : navigation T1→T2→T3(→T4) via les flèches ──
  if (sp.mode === "trimester") {
    const todayYmd = ymd(new Date());
    let def = trimestres.findIndex((t) => ymd(t.from) <= todayYmd && todayYmd <= ymd(t.to));
    if (def < 0) def = 0;
    const raw = sp.trim != null && sp.trim !== "" ? Number(sp.trim) : def;
    const idx = Math.min(Math.max(Number.isFinite(raw) ? raw : def, 0), trimestres.length - 1);
    const t = trimestres[idx];
    return {
      mode: "trimester",
      fromYmd: ymd(t.from),
      toYmd: ymd(t.to),
      dateParam,
      trimIndex: idx,
      trimestres: trimList,
      subtitle: t.label,
      prevHref: idx > 0 ? `${base}?mode=trimester&trim=${idx - 1}${exq}` : null,
      nextHref: idx < trimestres.length - 1 ? `${base}?mode=trimester&trim=${idx + 1}${exq}` : null,
    };
  }

  // ── Mensuel ──
  if (sp.mode === "month") {
    const from = monthStart(ref);
    const to = monthEnd(ref);
    return {
      mode: "month",
      fromYmd: ymd(from),
      toYmd: ymd(to),
      dateParam,
      trimIndex: null,
      trimestres: trimList,
      subtitle: cap(fmtMonth.format(from)),
      prevHref: `${base}?mode=month&date=${ymd(addMonthsToFirst(from, -1))}${exq}`,
      nextHref: `${base}?mode=month&date=${ymd(addMonthsToFirst(from, 1))}${exq}`,
    };
  }

  // ── Hebdomadaire (défaut) ──
  const from = mondayOf(ref);
  const to = addDays(from, 6);
  return {
    mode: "week",
    fromYmd: ymd(from),
    toYmd: ymd(to),
    dateParam,
    trimIndex: null,
    trimestres: trimList,
    subtitle: `du ${fmtShort.format(from)} au ${fmtShort.format(to)}`,
    prevHref: `${base}?mode=week&date=${ymd(addDays(from, -7))}${exq}`,
    nextHref: `${base}?mode=week&date=${ymd(addDays(from, 7))}${exq}`,
  };
}

// ── Totaux & ruptures (sous-totaux) des éditions ──

export type Totals = {
  seances: number;
  inscrits: number;
  enfants: number;
  accompagnants: number;
  presents: number;
  absents: number;
};

/** Cumul des compteurs d'une liste de séances (séances, inscrits, enfants, accompagnants,
 *  présents/absents d'après le pointage). */
export function computeTotals(sessions: DatedSession[]): Totals {
  const t: Totals = {
    seances: sessions.length,
    inscrits: 0,
    enfants: 0,
    accompagnants: 0,
    presents: 0,
    absents: 0,
  };
  for (const s of sessions) {
    for (const a of s.attendees) {
      t.inscrits += 1;
      t.enfants += a.enfants;
      t.accompagnants += a.accompagnants;
      if (a.pointage === "present") t.presents += 1;
      else if (a.pointage === "absent") t.absents += 1;
    }
  }
  return t;
}

export type SessionBucket = { key: string; label: string; sessions: DatedSession[] };

/**
 * Découpe les séances en « ruptures » selon la vue : par SEMAINE en vue mensuelle,
 * par TRIMESTRE en vue annuelle (selon `trimestres`), par MOIS en vue trimestrielle,
 * et un seul bloc (sans rupture) en vue hebdomadaire. Les séances étant déjà triées
 * chronologiquement, les ruptures aussi.
 */
export function bucketSessions(
  mode: RangeMode,
  sessions: DatedSession[],
  trimestres: { label: string; fromYmd: string; toYmd: string }[] = [],
): SessionBucket[] {
  if (mode === "week") return sessions.length ? [{ key: "week", label: "", sessions }] : [];
  const map = new Map<string, SessionBucket>();
  for (const s of sessions) {
    let key: string;
    let label: string;
    if (mode === "month") {
      const monday = mondayOf(parseYmd(s.date));
      key = ymd(monday);
      label = `Semaine du ${fmtShort.format(monday)} au ${fmtShort.format(addDays(monday, 6))}`;
    } else if (mode === "year" && trimestres.length > 0) {
      // Annuel : rupture par TRIMESTRE de l'exercice (repli par mois hors trimestre).
      const idx = trimestres.findIndex((t) => t.fromYmd <= s.date && s.date <= t.toYmd);
      if (idx >= 0) {
        key = `tri-${idx}`;
        label = trimestres[idx].label;
      } else {
        key = s.date.slice(0, 7);
        label = cap(fmtMonth.format(parseYmd(s.date)));
      }
    } else {
      key = s.date.slice(0, 7);
      label = cap(fmtMonth.format(parseYmd(s.date)));
    }
    const b = map.get(key);
    if (b) b.sessions.push(s);
    else map.set(key, { key, label, sessions: [s] });
  }
  return [...map.values()];
}

// ── Liste des réservations : vue alphabétique (réservations triées + total) ──
// (La vue « par date » liste les OCCURRENCES via listDatedSessions + bucketSessions.)

export type RowTotals = { reservations: number; enfants: number; accompagnants: number };

/** Cumul d'une liste de réservations (nb réservations + enfants + accompagnants). */
export function computeRowTotals(rows: EditionRow[]): RowTotals {
  const t: RowTotals = { reservations: 0, enfants: 0, accompagnants: 0 };
  for (const r of rows) {
    t.reservations += 1;
    t.enfants += r.enfants;
    t.accompagnants += r.accompagnants;
  }
  return t;
}

/** Réservations triées alphabétiquement (Nom, Prénom). Ne mute pas l'entrée. */
export function sortRowsAlpha(rows: EditionRow[]): EditionRow[] {
  return [...rows].sort((a, z) => a.nom.localeCompare(z.nom) || a.prenom.localeCompare(z.prenom));
}
