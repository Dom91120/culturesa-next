import { prisma } from "@/server/db";
import { type StatsType, getServiceStats } from "@/server/services/stats";
import { notFound } from "next/navigation";
import { StatsFilters } from "./stats-filters";
import { StatsToolbar } from "./stats-toolbar";

function StatCard({
  value,
  label,
  color,
  hint,
}: {
  value: number | string;
  label: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 130,
        background: "var(--surface1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.1rem",
      }}
    >
      <div
        style={{
          fontSize: "1.7rem",
          fontWeight: 700,
          color: color ?? "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: ".72rem",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
          marginTop: ".25rem",
        }}
      >
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: ".15rem" }}>{hint}</div>
      )}
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
  suffix,
}: { label: string; value: number; max: number; color?: string; suffix?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: ".5rem" }}>
      <div
        style={{
          width: 120,
          fontSize: ".75rem",
          color: "var(--muted)",
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          height: 16,
          background: "rgba(127,127,127,.12)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color ?? "var(--accent)",
            borderRadius: 4,
          }}
        />
      </div>
      <div
        style={{ width: 44, fontSize: ".75rem", fontWeight: 600, textAlign: "left", flexShrink: 0 }}
      >
        {value}
        {suffix ?? ""}
      </div>
    </div>
  );
}

function Panel({
  title,
  empty,
  children,
}: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-title" style={{ fontSize: ".82rem" }}>
        <span className="dot" />
        {title}
      </div>
      {empty ? (
        <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>Aucune donnée.</p>
      ) : (
        children
      )}
    </div>
  );
}

/** Barre empilée présents / absents / non pointés (prévu = total). */
function SegmentBar({ present, absent, none }: { present: number; absent: number; none: number }) {
  const tot = present + absent + none;
  if (tot === 0) return null;
  const pc = (n: number) => `${(100 * n) / tot}%`;
  return (
    <div
      style={{
        display: "flex",
        height: 20,
        borderRadius: 5,
        overflow: "hidden",
        marginTop: ".4rem",
      }}
    >
      {present > 0 && (
        <div
          title={`Présents : ${present}`}
          style={{ width: pc(present), background: "var(--accent)" }}
        />
      )}
      {absent > 0 && (
        <div
          title={`Absents : ${absent}`}
          style={{ width: pc(absent), background: "var(--danger)" }}
        />
      )}
      {none > 0 && (
        <div
          title={`Non pointés : ${none}`}
          style={{ width: pc(none), background: "rgba(127,127,127,.3)" }}
        />
      )}
    </div>
  );
}

function parseType(v: string | undefined): StatsType {
  return v === "rec" || v === "uniq" ? v : "all";
}
function parseDate(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const type = parseType(sp.type);
  const dateFrom = parseDate(sp.from);
  const dateTo = parseDate(sp.to);

  const [stats, periodRows] = await Promise.all([
    getServiceStats(id, { type, dateFrom, dateTo }),
    prisma.period.findMany({
      where: { serviceId: id, state: "actif" },
      orderBy: [{ dateStart: "asc" }, { id: "asc" }],
      select: { id: true, label: true, dateStart: true, dateEnd: true },
    }),
  ]);

  const periods = periodRows.map((p) => ({
    id: p.id,
    label: p.label,
    dateStart: p.dateStart ? p.dateStart.toISOString().slice(0, 10) : null,
    dateEnd: p.dateEnd ? p.dateEnd.toISOString().slice(0, 10) : null,
  }));

  const dayMax = Math.max(1, ...stats.byDay.map((r) => r.value));
  const monthMax = Math.max(1, ...stats.byMonth.map((r) => r.value));
  const structMax = Math.max(1, ...stats.topStructures.map((r) => r.value));
  const niveauMax = Math.max(1, ...stats.topNiveaux.map((r) => r.value));
  const effMax = Math.max(1, ...stats.effectifsByExercice.map((r) => r.value));

  const eqs = new URLSearchParams();
  if (type !== "all") eqs.set("type", type);
  if (dateFrom) eqs.set("from", dateFrom);
  if (dateTo) eqs.set("to", dateTo);
  const exportHref = `/services/${id}/stats/export${eqs.toString() ? `?${eqs}` : ""}`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Statistiques — {service.label}
        </div>
        <StatsToolbar exportHref={exportHref} />
      </div>

      <StatsFilters
        type={type === "all" ? "" : type}
        dateFrom={dateFrom ?? ""}
        dateTo={dateTo ?? ""}
        periods={periods}
      />

      {/* KPIs généraux */}
      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <StatCard value={stats.total} label="Réservations" />
        <StatCard value={stats.distinctUsers} label="Usagers distincts" />
        {stats.pending > 0 && (
          <StatCard value={stats.pending} label="Demandes en attente" color="var(--warn)" />
        )}
        <StatCard value={stats.enfants} label="Enfants" />
        {stats.accompagnants > 0 && <StatCard value={stats.accompagnants} label="Accompagnants" />}
      </div>

      {/* Prévu / Réalisé (pointage) */}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="panel-title" style={{ fontSize: ".82rem" }}>
          <span className="dot" />
          Prévu / Réalisé — séances passées
        </div>
        {stats.prevu === 0 ? (
          <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>
            Aucune séance datée passée sur le périmètre sélectionné.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap" }}>
              <StatCard value={stats.prevu} label="Prévu (séances)" />
              <StatCard value={stats.presents} label="Réalisé (présents)" color="var(--accent)" />
              <StatCard value={stats.absents} label="Absents" color="var(--danger)" />
              <StatCard value={stats.nonPointes} label="Non pointés" color="var(--muted)" />
              <StatCard
                value={stats.tauxPresence != null ? `${stats.tauxPresence}%` : "—"}
                label="Taux de présence"
                color="var(--accent)"
                hint="présents / (présents + absents)"
              />
              <StatCard
                value={stats.tauxRealisation != null ? `${stats.tauxRealisation}%` : "—"}
                label="Taux de réalisation"
                hint="présents / prévu"
              />
            </div>
            <SegmentBar present={stats.presents} absent={stats.absents} none={stats.nonPointes} />
            <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".35rem" }}>
              <span style={{ color: "var(--accent)" }}>■</span> Présents&nbsp;&nbsp;
              <span style={{ color: "var(--danger)" }}>■</span> Absents&nbsp;&nbsp;
              <span style={{ color: "rgba(127,127,127,.6)" }}>■</span> Non pointés
            </div>
          </>
        )}
      </div>

      {/* Graphes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: ".85rem",
        }}
      >
        <Panel title="Réservations par jour" empty={stats.byDay.length === 0}>
          {stats.byDay.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={dayMax} />
          ))}
        </Panel>

        <Panel title="Évolution mensuelle" empty={stats.byMonth.length === 0}>
          {stats.byMonth.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={monthMax} color="#e8a45a" />
          ))}
        </Panel>

        <Panel title="Top structures" empty={stats.topStructures.length === 0}>
          {stats.topStructures.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={structMax} color="#e06b6b" />
          ))}
        </Panel>

        <Panel title="Top niveaux" empty={stats.topNiveaux.length === 0}>
          {stats.topNiveaux.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={niveauMax} color="#5ab4e8" />
          ))}
        </Panel>

        <Panel
          title="Remplissage moyen par structure (jauge)"
          empty={stats.fillByStructure.length === 0}
        >
          {stats.fillByStructure.map((r) => (
            <BarRow
              key={r.label}
              label={r.label}
              value={r.value}
              max={100}
              color="#a07dd4"
              suffix="%"
            />
          ))}
        </Panel>

        <Panel
          title="Effectifs (enfants) par exercice"
          empty={stats.effectifsByExercice.length === 0}
        >
          {stats.effectifsByExercice.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={effMax} color="#6dceaa" />
          ))}
        </Panel>
      </div>
    </div>
  );
}
