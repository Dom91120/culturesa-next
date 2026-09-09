import { notFound } from "next/navigation";
import { CalendarTimeGlyph, CircleCheckGlyph } from "@/components/ui-glyphs";
import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import {
  bucketSessions,
  computeTotals,
  type EditionExerciceOption,
  type RangeMode,
  type RangeResult,
  rangeSearchParams,
  resolveEditionExercice,
  resolveRange,
  type SessionBucket,
} from "./range";
import { RangeBar } from "./range-bar";
import { RuptureHeading, TotalsLine } from "./totals";

// ════════════════════════════════════════════════════════════
//  Écran d'édition DATÉ (Planning / Pointages) : prologue serveur et squelette de
//  rendu COMMUNS — audit 2026-07-17 : les deux pages étaient identiques à ~100
//  lignes près (chargement, plage, buckets, RangeBar, sous-totaux), seul le rendu
//  d'un bucket différait. Chaque écran ne fournit plus que son titre par plage et
//  son `renderBucket`.
// ════════════════════════════════════════════════════════════

export type EditionScreen = "planning" | "pointages";

export type EditionSearchParams = {
  mode?: string;
  date?: string;
  week?: string;
  trim?: string;
  ruptures?: string;
  exercice?: string;
  page?: string;
};

// ── Pagination à la feuille (Dom 2026-09-09) ────────────────────────────────────────
// L'écran découpe les séances en pages dont chacune tient à peu près sur une feuille A4
// paysage (celle du PDF). Une séance ne se coupe jamais ; son « poids » est estimé en
// lignes : en-tête + une ligne par inscrit (pointages), en-tête + rangées de cartes
// (planning, 4 cartes de 6 lignes par rangée). Le PDF, lui, reste complet (bloc
// `.print-block-only`) : Puppeteer pagine lui-même.
const PAGE_UNITS = 18; // calé sur le PDF : ~5 séances de pointage par feuille A4 paysage
function sessionWeight(screen: EditionScreen, s: DatedSession): number {
  const n = s.attendees.length;
  return screen === "pointages" ? 2 + n : 2 + Math.max(1, Math.ceil(n / 4)) * 6;
}
function paginateSessions(screen: EditionScreen, sessions: DatedSession[]): DatedSession[][] {
  const pages: DatedSession[][] = [];
  let cur: DatedSession[] = [];
  let load = 0;
  for (const s of sessions) {
    const w = sessionWeight(screen, s);
    if (cur.length > 0 && load + w > PAGE_UNITS) {
      pages.push(cur);
      cur = [];
      load = 0;
    }
    cur.push(s);
    load += w;
  }
  if (cur.length > 0) pages.push(cur);
  return pages;
}

// Titre de l'écran selon la plage affichée (accords propres à chaque écran).
const TITLES: Record<EditionScreen, Record<RangeMode, string>> = {
  planning: {
    week: "Planning hebdomadaire",
    month: "Planning mensuel",
    trimester: "Planning trimestriel",
    year: "Planning annuel",
  },
  pointages: {
    week: "Pointages hebdomadaires",
    month: "Pointages mensuels",
    trimester: "Pointages trimestriels",
    year: "Pointages annuels",
  },
};

export type EditionScreenData = {
  serviceLabel: string;
  exercices: { id: number; label: string }[];
  selected: EditionExerciceOption | null;
  range: RangeResult;
  titleLabel: string;
  sessions: DatedSession[];
  withRuptures: boolean;
  buckets: SessionBucket[];
  withSubtotals: boolean;
  pdfHref: string;
  /** Pagination écran : page courante (1-based), nombre de pages, séances de la page, lien. */
  paging: {
    page: number;
    pages: number;
    pageSessions: DatedSession[];
    href: (n: number) => string;
  };
};

/**
 * Prologue commun : service (404 sinon), exercices éligibles + sélection, plage,
 * séances datées scoppées à l'exercice, ruptures et lien PDF (mêmes paramètres que
 * l'écran, cf. rangeSearchParams).
 */
export async function loadEditionScreen(
  id: string,
  screen: EditionScreen,
  sp: EditionSearchParams,
): Promise<EditionScreenData> {
  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  const range = resolveRange(id, screen, sp, selected, selected?.id);
  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd, selected?.periodIds);
  // Ruptures (case « avec ruptures ») : par semaine (vue mensuelle) / par mois (vue
  // période). OFF par défaut → un seul bloc sans en-tête ni sous-total.
  const withRuptures = sp.ruptures === "1";
  // Impression = PDF serveur (Puppeteer) : même vue (plage/ruptures/exercice).
  const pdfParams = rangeSearchParams(range, selected?.id ?? null, withRuptures);
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions, range.trimestres)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const pageList = paginateSessions(screen, sessions);
  const pages = Math.max(1, pageList.length);
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const href = (n: number) => {
    const q = rangeSearchParams(range, selected?.id ?? null, withRuptures);
    q.set("page", String(n));
    return `/services/${id}/editions/${screen}?${q.toString()}`;
  };
  return {
    serviceLabel: service.label,
    exercices,
    selected,
    range,
    titleLabel: TITLES[screen][range.mode],
    sessions,
    withRuptures,
    buckets,
    withSubtotals: withRuptures && buckets.length > 1,
    pdfHref: `/services/${id}/editions/pdf?kind=${screen}&${pdfParams.toString()}`,
    paging: { page, pages, pageSessions: pageList[page - 1] ?? [], href },
  };
}

/**
 * Squelette de rendu commun : RangeBar (titre + nav exercice + libellé imprimé),
 * état vide, puis les buckets — en-tête de rupture, contenu fourni par l'écran
 * (`renderBucket`), sous-totaux et total général.
 */
export function EditionScreenView({
  serviceId,
  screen,
  data,
  renderBucket,
}: {
  serviceId: string;
  screen: EditionScreen;
  data: EditionScreenData;
  renderBucket: (b: SessionBucket) => React.ReactNode;
}) {
  const {
    exercices,
    selected,
    range,
    titleLabel,
    sessions,
    withRuptures,
    buckets,
    withSubtotals,
    paging,
  } = data;

  // Rendu des buckets restreints à un sous-ensemble de séances (page écran) ou complets
  // (impression). En-tête « (suite) » si le bucket a commencé sur une page précédente ;
  // sous-total seulement sur la page où il se termine.
  const renderBuckets = (subset: Set<DatedSession> | null) =>
    buckets.map((b) => {
      const list = subset ? b.sessions.filter((x) => subset.has(x)) : b.sessions;
      if (list.length === 0) return null;
      const isContinuation = !!subset && b.sessions[0] !== list[0];
      const endsHere = !subset || b.sessions[b.sessions.length - 1] === list[list.length - 1];
      return (
        <div key={b.key}>
          {b.label && (
            <RuptureHeading>
              {b.label}
              {isContinuation ? " (suite)" : ""}
            </RuptureHeading>
          )}
          {renderBucket({ ...b, sessions: list })}
          {withSubtotals && endsHere && (
            <TotalsLine
              label={`Sous-total — ${b.label}`}
              totals={computeTotals(b.sessions)}
              variant={screen}
            />
          )}
        </div>
      );
    });
  const pageSet = new Set(paging.pageSessions);
  return (
    <div className="panel ed-screen">
      <RangeBar
        serviceId={serviceId}
        serviceLabel={data.serviceLabel}
        screen={screen}
        range={range}
        ruptures={withRuptures}
        pdfHref={data.pdfHref}
        selectedExerciceId={selected?.id ?? null}
        exercices={exercices}
        title={titleLabel}
        icon={
          screen === "planning" ? <CalendarTimeGlyph size={16} /> : <CircleCheckGlyph size={16} />
        }
      />

      {sessions.length === 0 ? (
        <p className="ed-empty">Aucune séance sur cette période.</p>
      ) : (
        <>
          {/* Écran : page courante (une feuille), masquée à l'impression. */}
          <div className="no-print">
            {renderBuckets(pageSet)}
            {paging.pages > 1 && (
              <div className="ed-paging">
                {paging.page > 1 ? (
                  <a
                    href={paging.href(paging.page - 1)}
                    className="acct-action"
                    aria-label="Page précédente"
                  >
                    ‹
                  </a>
                ) : (
                  <span className="acct-action is-off">‹</span>
                )}
                <span>
                  Feuille {paging.page} / {paging.pages} · {sessions.length} séance
                  {sessions.length > 1 ? "s" : ""}
                </span>
                {paging.page < paging.pages ? (
                  <a
                    href={paging.href(paging.page + 1)}
                    className="acct-action"
                    aria-label="Page suivante"
                  >
                    ›
                  </a>
                ) : (
                  <span className="acct-action is-off">›</span>
                )}
              </div>
            )}
            {paging.page === paging.pages && (
              <TotalsLine
                label="Total général"
                totals={computeTotals(sessions)}
                variant={screen}
                strong
              />
            )}
          </div>

          {/* Impression (PDF Puppeteer) : toutes les séances en un flux, Puppeteer pagine. */}
          <div className="print-block-only">
            {renderBuckets(null)}
            <TotalsLine
              label="Total général"
              totals={computeTotals(sessions)}
              variant={screen}
              strong
            />
          </div>
        </>
      )}
    </div>
  );
}
