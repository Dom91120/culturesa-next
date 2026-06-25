import { prisma } from "@/server/db";
import type { DatedSession } from "@/server/services/editions";

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
// Date + n mois « exacts » (même quantième) — pour le seuil « période > 1 mois ».
const addMonthsExact = (d: Date, n: number): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));

const fmtShort = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
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

export type EditionPeriod = {
  id: number;
  label: string;
  dateStart: Date | null;
  dateEnd: Date | null;
};

/** Périodes actives datées d'un service (pour le sélecteur de plage). */
export function fetchEditionPeriods(serviceId: string): Promise<EditionPeriod[]> {
  return prisma.period.findMany({
    where: { serviceId, state: "actif", dateStart: { not: null }, dateEnd: { not: null } },
    select: { id: true, label: true, dateStart: true, dateEnd: true },
    orderBy: { dateStart: "asc" },
  });
}

export type RangeMode = "week" | "month" | "period";
export type RangeResult = {
  mode: RangeMode;
  fromYmd: string;
  toYmd: string;
  dateParam: string;
  periodId: number | null;
  periodLabel: string | null;
  longPeriods: { id: number; label: string }[];
  subtitle: string;
  prevHref: string | null;
  nextHref: string | null;
};

/**
 * Résout la plage [from, to] + libellés + navigation à partir des paramètres d'URL
 * (`mode` = week|month|period, `date`, `periodId` ; compat `week`). `screen` = segment
 * de page (« planning » | « pointages ») pour construire les liens prev/next.
 */
export function resolveRange(
  serviceId: string,
  screen: string,
  sp: { mode?: string; date?: string; week?: string; periodId?: string },
  periods: EditionPeriod[],
): RangeResult {
  const base = `/services/${serviceId}/editions/${screen}`;
  const longPeriods = periods.filter(
    (p) => p.dateStart && p.dateEnd && p.dateEnd > addMonthsExact(p.dateStart, 1),
  );

  const dateParam =
    sp.date && reIso.test(sp.date)
      ? sp.date
      : sp.week && reIso.test(sp.week)
        ? sp.week
        : ymd(new Date());
  const ref = parseYmd(dateParam);

  const periodId = sp.periodId ? Number(sp.periodId) : null;
  const selected = sp.mode === "period" ? longPeriods.find((p) => p.id === periodId) : undefined;

  if (sp.mode === "period" && selected?.dateStart && selected.dateEnd) {
    return {
      mode: "period",
      fromYmd: ymd(selected.dateStart),
      toYmd: ymd(selected.dateEnd),
      dateParam,
      periodId,
      periodLabel: selected.label,
      longPeriods: longPeriods.map((p) => ({ id: p.id, label: p.label })),
      subtitle: `du ${fmtShort.format(selected.dateStart)} au ${fmtShort.format(selected.dateEnd)}`,
      prevHref: null,
      nextHref: null,
    };
  }

  if (sp.mode === "month") {
    const from = monthStart(ref);
    const to = monthEnd(ref);
    return {
      mode: "month",
      fromYmd: ymd(from),
      toYmd: ymd(to),
      dateParam,
      periodId: null,
      periodLabel: null,
      longPeriods: longPeriods.map((p) => ({ id: p.id, label: p.label })),
      subtitle: cap(fmtMonth.format(from)),
      prevHref: `${base}?mode=month&date=${ymd(addMonthsToFirst(from, -1))}`,
      nextHref: `${base}?mode=month&date=${ymd(addMonthsToFirst(from, 1))}`,
    };
  }

  const from = mondayOf(ref);
  const to = addDays(from, 6);
  return {
    mode: "week",
    fromYmd: ymd(from),
    toYmd: ymd(to),
    dateParam,
    periodId: null,
    periodLabel: null,
    longPeriods: longPeriods.map((p) => ({ id: p.id, label: p.label })),
    subtitle: `du ${fmtShort.format(from)} au ${fmtShort.format(to)}`,
    prevHref: `${base}?mode=week&date=${ymd(addDays(from, -7))}`,
    nextHref: `${base}?mode=week&date=${ymd(addDays(from, 7))}`,
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
 * par MOIS en vue période, et un seul bloc (sans rupture) en vue hebdomadaire. Les
 * séances étant déjà triées chronologiquement, l'ordre des ruptures l'est aussi.
 */
export function bucketSessions(mode: RangeMode, sessions: DatedSession[]): SessionBucket[] {
  if (mode === "week") return sessions.length ? [{ key: "week", label: "", sessions }] : [];
  const map = new Map<string, SessionBucket>();
  for (const s of sessions) {
    let key: string;
    let label: string;
    if (mode === "month") {
      const monday = mondayOf(parseYmd(s.date));
      key = ymd(monday);
      label = `Semaine du ${fmtShort.format(monday)} au ${fmtShort.format(addDays(monday, 6))}`;
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
