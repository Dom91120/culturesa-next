import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import { ExerciceNav } from "../exercice-nav";
import {
  bucketSessions,
  computeTotals,
  formatDateHeading,
  resolveEditionExercice,
  resolveRange,
} from "../range";
import { RangeBar } from "../range-bar";
import { RuptureHeading, TotalsLine } from "../totals";

export const metadata = { title: "CultuRésa — Plannings" };

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    mode?: string;
    date?: string;
    week?: string;
    trim?: string;
    ruptures?: string;
    exercice?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  const range = resolveRange(id, "planning", sp, selected, selected?.id);
  const titleLabel =
    range.mode === "month"
      ? "Planning mensuel"
      : range.mode === "trimester"
        ? "Planning trimestriel"
        : range.mode === "year"
          ? "Planning annuel"
          : "Planning hebdomadaire";

  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd, selected?.periodIds);
  // Ruptures (case « avec ruptures ») : par semaine (vue mensuelle) / par mois (vue
  // période). OFF par défaut → un seul bloc sans en-tête ni sous-total.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions, range.trimestres)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  const renderSection = (daySessions: DatedSession[]) => {
    const first = daySessions[0];
    return (
      <section key={first.date} style={{ marginBottom: "1.25rem", breakInside: "avoid" }}>
        <h3
          style={{
            fontSize: ".9rem",
            fontWeight: 700,
            borderBottom: "1px solid var(--border)",
            paddingBottom: ".2rem",
            marginBottom: ".5rem",
          }}
        >
          {formatDateHeading(first.date)}
        </h3>
        {daySessions.map((s) => (
          <div key={`${s.startTime}-${s.endTime}`} style={{ marginBottom: ".6rem" }}>
            <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".15rem" }}>
              {s.startTime && s.endTime
                ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
                : "Journée entière"}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
              </span>
            </div>
            {/* Cartes participants : côte à côte (flex-wrap) — elles passent à la ligne
                seulement quand la largeur ne suffit plus. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
              {s.attendees.map((a, i) => (
                <div
                  key={`${a.nom}-${a.prenom}-${i}`}
                  style={{
                    width: 200,
                    border: "1px solid var(--border)",
                    borderRadius: "var(--rad-sm)",
                    padding: ".35rem .6rem",
                    fontSize: ".82rem",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{`${a.nom} ${a.prenom}`.trim() || "—"}</div>
                  <div style={{ color: "var(--muted)", fontSize: ".76rem" }}>
                    {a.structure || a.demandeur || "—"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: ".76rem" }}>
                    Tel : {a.tel || "—"}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: ".76rem" }}>{a.email || "—"}</div>
                  <div style={{ color: "var(--muted)", fontSize: ".76rem" }}>{a.theme || "—"}</div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: ".75rem",
                      fontSize: ".76rem",
                      marginTop: ".15rem",
                    }}
                  >
                    <span>
                      {a.enfants} enfant{a.enfants > 1 ? "s" : ""}
                    </span>
                    <span>
                      {a.accompagnants} adulte{a.accompagnants > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  };

  return (
    <div>
      <RangeBar
        serviceId={id}
        screen="planning"
        range={range}
        ruptures={withRuptures}
        selectedExerciceId={selected?.id ?? null}
        title={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", fontWeight: 700 }}
          >
            {titleLabel}
            <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
            {service.label}
          </span>
        }
      />

      {sessions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune séance sur cette période.
        </p>
      ) : (
        <>
          {buckets.map((b) => {
            const byDate = new Map<string, DatedSession[]>();
            for (const s of b.sessions) {
              const arr = byDate.get(s.date);
              if (arr) arr.push(s);
              else byDate.set(s.date, [s]);
            }
            return (
              <div key={b.key}>
                {b.label && <RuptureHeading>{b.label}</RuptureHeading>}
                {[...byDate.values()].map(renderSection)}
                {withSubtotals && (
                  <TotalsLine
                    label={`Sous-total — ${b.label}`}
                    totals={computeTotals(b.sessions)}
                    variant="planning"
                  />
                )}
              </div>
            );
          })}
          <TotalsLine
            label="Total général"
            totals={computeTotals(sessions)}
            variant="planning"
            strong
          />
        </>
      )}
    </div>
  );
}
