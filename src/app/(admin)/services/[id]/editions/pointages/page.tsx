import { prisma } from "@/server/db";
import { type DatedSession, listDatedSessions } from "@/server/services/editions";
import { notFound } from "next/navigation";
import {
  bucketSessions,
  computeTotals,
  fetchEditionPeriods,
  formatDateHeading,
  resolveRange,
} from "../range";
import { RangeBar } from "../range-bar";
import { RuptureHeading, TotalsLine } from "../totals";

const POINTAGE_LABEL: Record<string, string> = { present: "Présent", absent: "Absent" };

export default async function PointagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    mode?: string;
    date?: string;
    week?: string;
    periodId?: string;
    ruptures?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, periods] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    fetchEditionPeriods(id),
  ]);
  if (!service) notFound();

  const range = resolveRange(id, "pointages", sp, periods);
  const titleLabel =
    range.mode === "period"
      ? `Pointages — ${range.periodLabel}`
      : range.mode === "month"
        ? "Pointages mensuels"
        : "Pointages hebdomadaires";

  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd);
  // Ruptures (case « avec ruptures ») OFF par défaut → un seul bloc sans sous-total.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions)
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
        {formatDateHeading(s.date)} · {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
          ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
        </span>
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Nom</th>
            <th style={th}>Prénom</th>
            <th style={th}>Structure</th>
            <th style={{ ...th, textAlign: "center" }}>Pointage</th>
            <th style={{ ...th, width: 160 }}>Émargement</th>
          </tr>
        </thead>
        <tbody>
          {s.attendees.map((a, i) => (
            <tr key={`${a.nom}-${a.prenom}-${i}`}>
              <td style={{ ...td, fontWeight: 600 }}>{a.nom}</td>
              <td style={td}>{a.prenom}</td>
              <td style={td}>{a.structure || "—"}</td>
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
      <RangeBar serviceId={id} screen="pointages" range={range} ruptures={withRuptures} />

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
