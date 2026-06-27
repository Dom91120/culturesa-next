import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import {
  bucketSessions,
  computeTotals,
  fetchCurrentExercice,
  formatDateHeading,
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
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, exercice] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    fetchCurrentExercice(id),
  ]);
  if (!service) notFound();

  const range = resolveRange(id, "planning", sp, exercice);
  const titleLabel =
    range.mode === "month"
      ? "Planning mensuel"
      : range.mode === "trimester"
        ? "Planning trimestriel"
        : range.mode === "year"
          ? "Planning annuel"
          : "Planning hebdomadaire";

  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd);
  // Ruptures (case « avec ruptures ») : par semaine (vue mensuelle) / par mois (vue
  // période). OFF par défaut → un seul bloc sans en-tête ni sous-total.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions, range.trimestres)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  const td: React.CSSProperties = {
    borderBottom: "1px solid var(--border)",
    padding: "3px 6px",
    fontSize: ".82rem",
    verticalAlign: "top",
  };

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
              {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
              </span>
            </div>
            {/* Colonnes fixes (table-layout) → alignées d'une séance à l'autre. */}
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "33%" }} />
                <col />
              </colgroup>
              <tbody>
                {s.attendees.map((a, i) => (
                  <tr key={`${a.nom}-${a.prenom}-${i}`}>
                    <td style={{ ...td, fontWeight: 600 }}>{a.nom || "—"}</td>
                    <td style={td}>{a.prenom || "—"}</td>
                    <td style={td}>{a.structure || "—"}</td>
                    <td style={td}>{a.theme || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    );
  };

  return (
    <div>
      <RangeBar serviceId={id} screen="planning" range={range} ruptures={withRuptures} />

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        {titleLabel} — {service.label}
      </h2>

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
