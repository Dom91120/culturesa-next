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

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; date?: string; week?: string; periodId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, periods] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    fetchEditionPeriods(id),
  ]);
  if (!service) notFound();

  const range = resolveRange(id, "planning", sp, periods);
  const titleLabel =
    range.mode === "period"
      ? `Planning — ${range.periodLabel}`
      : range.mode === "month"
        ? "Planning mensuel"
        : "Planning hebdomadaire";

  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd);
  // Ruptures : par semaine (vue mensuelle) / par mois (vue période) / aucune (hebdo).
  const buckets = bucketSessions(range.mode, sessions);
  const withSubtotals = buckets.length > 1;

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
            <div style={{ fontWeight: 600, fontSize: ".85rem" }}>
              {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>({s.attendees.length})</span>
            </div>
            <ul style={{ margin: ".2rem 0 0 1rem", fontSize: ".82rem", lineHeight: 1.5 }}>
              {s.attendees.map((a, i) => (
                <li key={`${a.nom}-${a.prenom}-${i}`}>
                  {a.nom} {a.prenom}
                  {a.structure ? ` — ${a.structure}` : ""}
                  {a.theme ? ` · ${a.theme}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    );
  };

  return (
    <div>
      <RangeBar serviceId={id} screen="planning" range={range} />

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
