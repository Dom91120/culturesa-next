import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions, POINTAGE_LABEL } from "@/server/services/editions";
import {
  bucketSessions,
  computeTotals,
  formatDateHeading,
  resolveEditionExercice,
  resolveRange,
} from "../range";
import { RangeBar } from "../range-bar";
import { RuptureHeading, TotalsLine } from "../totals";

export const metadata = { title: "CultuRésa — Pointages" };

export default async function PointagesPage({
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

  const range = resolveRange(id, "pointages", sp, selected, selected?.id);
  const titleLabel =
    range.mode === "month"
      ? "Pointages mensuels"
      : range.mode === "trimester"
        ? "Pointages trimestriels"
        : range.mode === "year"
          ? "Pointages annuels"
          : "Pointages hebdomadaires";

  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd, selected?.periodIds);
  // Ruptures (case « avec ruptures ») OFF par défaut → un seul bloc sans sous-total.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions, range.trimestres)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  const th: React.CSSProperties = {
    textAlign: "left",
    borderBottom: "1px solid var(--border)",
    padding: "3px 6px",
    fontSize: ".72rem",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    color: "var(--muted)",
  };
  const td: React.CSSProperties = {
    borderBottom: "1px solid var(--border)",
    padding: "4px 6px",
    fontSize: ".82rem",
  };

  const renderSession = (s: DatedSession) => (
    <section
      key={`${s.date}-${s.startTime}`}
      style={{ marginBottom: "1.25rem", breakInside: "avoid" }}
    >
      <h3 style={{ fontSize: ".9rem", fontWeight: 700, marginBottom: ".35rem" }}>
        {formatDateHeading(s.date)} ·{" "}
        {s.startTime && s.endTime
          ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
          : "Journée entière"}{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
          ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
        </span>
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "34%" }}>Identité</th>
            <th style={th}>Structure</th>
            <th style={{ ...th, width: 150 }}>Participants</th>
            <th style={{ ...th, textAlign: "center", width: 110 }}>Pointage</th>
            <th style={{ ...th, width: 180 }}>Émargement</th>
          </tr>
        </thead>
        <tbody>
          {s.attendees.map((a, i) => (
            <tr key={`${a.nom}-${a.prenom}-${i}`}>
              <td style={{ ...td, fontWeight: 600 }}>{`${a.nom} ${a.prenom}`.trim() || "—"}</td>
              <td style={td}>{a.structure || a.demandeur || "—"}</td>
              <td style={td}>
                {a.enfants} enfant{a.enfants > 1 ? "s" : ""} + {a.accompagnants} adulte
                {a.accompagnants > 1 ? "s" : ""}
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                {a.pointage ? POINTAGE_LABEL[a.pointage] : "—"}
              </td>
              <td style={td} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <div>
      <RangeBar
        serviceId={id}
        screen="pointages"
        range={range}
        ruptures={withRuptures}
        exercices={exercices}
        selectedExerciceId={selected?.id ?? null}
      />

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        {titleLabel} — {service.label}
      </h2>

      {sessions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune séance sur cette période.
        </p>
      ) : (
        <>
          {buckets.map((b) => (
            <div key={b.key}>
              {b.label && <RuptureHeading>{b.label}</RuptureHeading>}
              {b.sessions.map(renderSession)}
              {withSubtotals && (
                <TotalsLine
                  label={`Sous-total — ${b.label}`}
                  totals={computeTotals(b.sessions)}
                  variant="pointages"
                />
              )}
            </div>
          ))}
          <TotalsLine
            label="Total général"
            totals={computeTotals(sessions)}
            variant="pointages"
            strong
          />
        </>
      )}
    </div>
  );
}
