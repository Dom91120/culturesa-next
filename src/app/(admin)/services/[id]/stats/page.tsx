import { prisma } from "@/server/db";
import { type LabeledCount, type StatsType, getServiceStats } from "@/server/services/stats";
import { notFound } from "next/navigation";
import { StatsFilters } from "./stats-filters";
import { StatsToolbar } from "./stats-toolbar";

// Palette catégorielle (anneaux & barres). Émeraude = accent du thème.
const PALETTE = [
  "#2caf7f",
  "#5ab4e8",
  "#e8a45a",
  "#a07dd4",
  "#e06b6b",
  "#6dceaa",
  "#d98cc0",
  "#8a93a8",
];
const C_PRESENT = "#2caf7f";
const C_ABSENT = "#e06b6b";
const C_NONE = "rgba(127,127,127,.32)";

// ── Briques d'affichage ───────────────────────────────────────────────────────

function MetricCard({
  value,
  label,
  color,
  sub,
  hint,
}: {
  value: number | string;
  label: string;
  color?: string;
  sub?: string;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      style={{
        flex: 1,
        minWidth: 120,
        position: "relative",
        background: "var(--surface1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.1rem",
        overflow: "hidden",
        cursor: hint ? "help" : undefined,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: color ?? "var(--accent)",
        }}
      />
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
          fontSize: ".62rem",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: ".08em",
          marginTop: ".25rem",
        }}
      >
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".3rem" }}>{sub}</div>
      )}
    </div>
  );
}

/** Anneau SVG multi-segments (server-rendered, sans dépendance). */
function Donut({
  segments,
  size = 156,
  thickness = 20,
  centerValue,
  centerLabel,
  centerColor,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerLabel?: string;
  centerColor?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(127,127,127,.12)"
          strokeWidth={thickness}
        />
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * c;
            const off = (acc / total) * c;
            acc += s.value;
            return (
              <circle
                key={s.color}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-off}
              />
            );
          })}
      </svg>
      {(centerValue || centerLabel) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          {centerValue && (
            <div
              style={{
                fontSize: "1.55rem",
                fontWeight: 700,
                lineHeight: 1,
                color: centerColor ?? "var(--text)",
              }}
            >
              {centerValue}
            </div>
          )}
          {centerLabel && (
            <div
              style={{
                fontSize: ".6rem",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                marginTop: ".25rem",
              }}
            >
              {centerLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Réduit une série à top K + « Autres » (pour des anneaux lisibles). */
function forDonut(data: LabeledCount[], k = 5): LabeledCount[] {
  if (data.length <= k + 1) return data;
  const head = data.slice(0, k);
  const rest = data.slice(k).reduce((s, x) => s + x.value, 0);
  return rest > 0 ? [...head, { label: "Autres", value: rest }] : head;
}

function Legend({
  items,
}: { items: { label: string; value: number; color: string; suffix?: string }[] }) {
  const tot = items.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", minWidth: 0, flex: 1 }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".76rem" }}
        >
          <span
            style={{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }}
          />
          <span
            style={{
              color: "var(--muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </span>
          <span style={{ marginLeft: "auto", fontWeight: 600, flexShrink: 0 }}>
            {it.value}
            {it.suffix ?? ""}
          </span>
          <span style={{ color: "var(--muted)", width: 38, textAlign: "right", flexShrink: 0 }}>
            {Math.round((100 * it.value) / tot)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function DonutPanel({
  title,
  data,
  centerValue,
  centerLabel,
  centerColor,
  palette = PALETTE,
}: {
  title: string;
  data: LabeledCount[];
  centerValue?: string;
  centerLabel?: string;
  centerColor?: string;
  palette?: string[];
}) {
  const colored = data.map((d, i) => ({ ...d, color: d.color ?? palette[i % palette.length] }));
  const empty = colored.every((d) => d.value === 0);
  return (
    <div className="panel">
      <div className="panel-title" style={{ fontSize: ".82rem" }}>
        <span className="dot" />
        {title}
      </div>
      {empty ? (
        <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>Aucune donnée.</p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", flexWrap: "wrap" }}>
          <Donut
            segments={colored.map((d) => ({ value: d.value, color: d.color }))}
            centerValue={centerValue}
            centerLabel={centerLabel}
            centerColor={centerColor}
          />
          <Legend
            items={colored.map((d) => ({ label: d.label, value: d.value, color: d.color }))}
          />
        </div>
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
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
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

/** Courbe d'aire (évolution mensuelle) — SVG étiré en largeur, trait non déformé. */
function AreaChart({ data, color }: { data: LabeledCount[]; color: string }) {
  const W = 320;
  const H = 130;
  const pad = 14;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `${x(0)},${H - pad} ${line} ${x(n - 1)},${H - pad}`;
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="150"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon points={area} fill={color} opacity={0.15} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, marginTop: ".3rem" }}
      >
        {data.map((d) => (
          <div key={d.label} style={{ textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: ".8rem", fontWeight: 600 }}>{d.value}</div>
            <div
              style={{
                fontSize: ".62rem",
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {d.label}
            </div>
          </div>
        ))}
      </div>
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

  const structMax = Math.max(1, ...stats.fillByStructure.map((r) => r.value));
  const niveauMax = Math.max(1, ...stats.topNiveaux.map((r) => r.value));
  const effMax = Math.max(1, ...stats.effectifsByExercice.map((r) => r.value));

  // Métriques dérivées « intéressantes ».
  const moyEnfants = stats.total > 0 ? (stats.enfants / stats.total).toFixed(1) : "0";
  const moyParUsager =
    stats.distinctUsers > 0 ? (stats.total / stats.distinctUsers).toFixed(1) : "0";
  const peakDay = [...stats.byDay].sort((a, b) => b.value - a.value)[0];

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

      {/* Bandeau KPIs */}
      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <MetricCard value={stats.total} label="Réservations" sub={`${moyParUsager} / usager`} />
        <MetricCard value={stats.distinctUsers} label="Usagers distincts" color="#5ab4e8" />
        <MetricCard
          value={stats.enfants}
          label="Enfants"
          color="#e8a45a"
          sub={`${moyEnfants} / réservation`}
        />
        {stats.accompagnants > 0 && (
          <MetricCard value={stats.accompagnants} label="Accompagnants" color="#a07dd4" />
        )}
        <MetricCard
          value={stats.avgFill != null ? `${stats.avgFill}%` : "—"}
          label="Remplissage moyen"
          color="#6dceaa"
          hint="Occupation moyenne (jauge) des créneaux réservés"
        />
        {stats.pending > 0 && (
          <MetricCard value={stats.pending} label="Demandes en attente" color="var(--warn)" />
        )}
      </div>

      {/* Anneaux */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
          gap: ".85rem",
          marginBottom: ".85rem",
        }}
      >
        {stats.prevu > 0 && (
          <DonutPanel
            title="Présence — séances passées"
            data={[
              { label: "Présents", value: stats.presents, color: C_PRESENT },
              { label: "Absents", value: stats.absents, color: C_ABSENT },
              { label: "Non pointés", value: stats.nonPointes, color: C_NONE },
            ]}
            centerValue={stats.tauxPresence != null ? `${stats.tauxPresence}%` : "—"}
            centerLabel="présence"
            centerColor={C_PRESENT}
          />
        )}

        <DonutPanel
          title="Type de réservation"
          data={[
            { label: "Récurrentes", value: stats.recurringCount, color: C_PRESENT },
            { label: "Ponctuelles", value: stats.uniqueCount, color: "#5ab4e8" },
          ]}
          centerValue={String(stats.total)}
          centerLabel="réservations"
        />

        <DonutPanel
          title="Répartition par jour"
          data={forDonut(stats.byDay, 6)}
          centerValue={peakDay ? peakDay.label.slice(0, 3) : "—"}
          centerLabel="jour fort"
        />

        <DonutPanel
          title="Top structures"
          data={forDonut(stats.topStructures, 5)}
          centerValue={String(stats.distinctUsers)}
          centerLabel="usagers"
        />
      </div>

      {/* Évolution + barres */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
          gap: ".85rem",
        }}
      >
        <Panel title="Évolution mensuelle" empty={stats.byMonth.length === 0}>
          <AreaChart data={stats.byMonth} color="#e8a45a" />
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

        <Panel title="Top niveaux" empty={stats.topNiveaux.length === 0}>
          {stats.topNiveaux.map((r) => (
            <BarRow key={r.label} label={r.label} value={r.value} max={niveauMax} color="#5ab4e8" />
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

        <Panel title="Top structures (volume)" empty={stats.topStructures.length === 0}>
          {stats.topStructures.map((r) => (
            <BarRow
              key={r.label}
              label={r.label}
              value={r.value}
              max={Math.max(1, ...stats.topStructures.map((s) => s.value))}
              color="#e06b6b"
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}
