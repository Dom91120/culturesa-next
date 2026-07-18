import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import { ExerciceNav } from "./exercice-nav";
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
};

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
  const { exercices, selected, range, titleLabel, sessions, withRuptures, buckets, withSubtotals } =
    data;
  return (
    <div>
      <RangeBar
        serviceId={serviceId}
        screen={screen}
        range={range}
        ruptures={withRuptures}
        pdfHref={data.pdfHref}
        selectedExerciceId={selected?.id ?? null}
        title={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", fontWeight: 700 }}
          >
            {titleLabel}
            <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
            <span className="print-only">- {data.serviceLabel}</span>
          </span>
        }
      />

      {sessions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune séance sur cette période.
        </p>
      ) : (
        <>
          {buckets.map((b) => (
            <div key={b.key}>
              {b.label && <RuptureHeading>{b.label}</RuptureHeading>}
              {renderBucket(b)}
              {withSubtotals && (
                <TotalsLine
                  label={`Sous-total — ${b.label}`}
                  totals={computeTotals(b.sessions)}
                  variant={screen}
                />
              )}
            </div>
          ))}
          <TotalsLine
            label="Total général"
            totals={computeTotals(sessions)}
            variant={screen}
            strong
          />
        </>
      )}
    </div>
  );
}
