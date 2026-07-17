import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import {
  currentExerciceIdForService,
  eligiblePeriodsWhere,
  pickEligibleExercices,
} from "@/server/services/exercice";
import { getServiceStats, type LabeledCount } from "@/server/services/stats";
import { parseStatsDate, parseStatsType } from "./params";
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
  size = 120,
  thickness = 16,
  centerValue,
  centerLabel,
  centerColor,
  centerValueSize = "1.3rem",
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerLabel?: string;
  centerColor?: string;
  centerValueSize?: string;
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
                fontSize: centerValueSize,
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
}: {
  items: { label: string; value: number; color: string; suffix?: string }[];
}) {
  const tot = items.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", minWidth: 0, flex: 1 }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: ".4rem",
            fontSize: ".71rem",
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: it.color,
              flexShrink: 0,
              marginTop: 3,
            }}
          />
          {/* Libellé : colonne flexible bornée par les colonnes nombre/% ; passe à la ligne
              (pas d'ellipsis) pour les noms longs, sans pousser le % hors du panneau. */}
          <span
            style={{
              color: "var(--muted)",
              letterSpacing: "-.2px",
              flex: 1,
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {it.label}
          </span>
          <span
            style={{
              marginLeft: "auto",
              minWidth: 28,
              textAlign: "right",
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {it.value}
            {it.suffix ?? ""}
          </span>
          <span
            style={{
              color: "var(--muted)",
              width: 40,
              textAlign: "right",
              marginLeft: ".7rem",
              flexShrink: 0,
            }}
          >
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
  centerValueSize,
  palette = PALETTE,
}: {
  title: string;
  data: LabeledCount[];
  centerValue?: string;
  centerLabel?: string;
  centerColor?: string;
  centerValueSize?: string;
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
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: ".85rem" }}
        >
          <Donut
            segments={colored.map((d) => ({ value: d.value, color: d.color }))}
            centerValue={centerValue}
            centerLabel={centerLabel}
            centerColor={centerColor}
            centerValueSize={centerValueSize}
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
  labelAbove = false,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  suffix?: string;
  // true = libellé sur sa propre ligne AU-DESSUS de la barre (texte entier, pas d'ellipsis) ;
  // false (défaut) = libellé à gauche dans une colonne fixe (tronqué si trop long).
  labelAbove?: boolean;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const bar = (
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
  );
  const val = (
    <div
      style={{ width: 44, fontSize: ".75rem", fontWeight: 600, textAlign: "left", flexShrink: 0 }}
    >
      {value}
      {suffix ?? ""}
    </div>
  );

  if (labelAbove) {
    return (
      <div style={{ marginBottom: ".5rem" }}>
        <div
          style={{
            fontSize: ".72rem",
            color: "var(--muted)",
            lineHeight: 1.2,
            marginBottom: ".2rem",
            overflowWrap: "anywhere",
          }}
        >
          {label}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          {bar}
          {val}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: ".5rem" }}>
      <div
        style={{
          width: 96,
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
      {bar}
      {val}
    </div>
  );
}

function Panel({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-title" style={{ fontSize: ".82rem" }}>
        <span className="dot" />
        {title}
      </div>
      {hint && (
        <div style={{ fontSize: ".68rem", color: "var(--muted)", margin: "-.35rem 0 .6rem" }}>
          {hint}
        </div>
      )}
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

/** Courbe de pourcentage (0–100 %) avec points et repères — ex. remplissage moyen/mois. */
function FillCurve({ data, color }: { data: LabeledCount[]; color: string }) {
  const W = 320;
  const H = 130;
  const pad = 14;
  const n = data.length;
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (v: number) => H - pad - (Math.min(100, v) / 100) * (H - 2 * pad);
  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const grid = [0, 50, 100];
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ height: "auto", display: "block" }}
        aria-hidden="true"
      >
        {grid.map((g) => (
          <g key={g}>
            <line
              x1={0}
              x2={W}
              y1={y(g)}
              y2={y(g)}
              stroke="rgba(127,127,127,.15)"
              strokeWidth={0.5}
            />
            <text x={2} y={y(g) - 2} fontSize={7} fill="var(--muted)">
              {g}%
            </text>
          </g>
        ))}
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => (
          <circle
            key={d.label}
            cx={x(i)}
            cy={y(d.value)}
            r={3}
            fill={color}
            stroke="var(--surface1)"
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <div
        style={{ display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, marginTop: ".3rem" }}
      >
        {data.map((d) => (
          <div key={d.label} style={{ textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: ".62rem", fontWeight: 600 }}>{d.value}%</div>
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

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; from?: string; to?: string; exercice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const service = await prisma.service.findUnique({
    where: { id },
    select: { label: true, showPreviousExercices: true },
  });
  if (!service) notFound();

  const type = parseStatsType(sp.type);
  const rawFrom = parseStatsDate(sp.from);
  const rawTo = parseStatsDate(sp.to);

  // Exercices éligibles (comme l'agenda) : l'exercice COURANT par défaut, tous les
  // exercices non archivés si le service « affiche les exercices précédents »
  // (les périodes des exercices passés restent « actif » depuis la simplification
  // des états). Le sélecteur porte sur ces exercices.
  const currentExoId = await currentExerciceIdForService(id);
  const periodRows = await prisma.period.findMany({
    where: eligiblePeriodsWhere(id, service.showPreviousExercices, currentExoId),
    orderBy: [{ dateStart: "asc" }, { id: "asc" }],
    select: {
      id: true,
      label: true,
      dateStart: true,
      dateEnd: true,
      exerciceId: true,
      exercice: { select: { id: true, label: true, dateStart: true, dateEnd: true } },
    },
  });

  // Exercices distincts + sélection (source unique, comme agenda/éditions).
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const picked = pickEligibleExercices(periodRows, sp.exercice ? Number(sp.exercice) : undefined);
  const exercices = picked.exercices.map((e) => ({ id: e.id, label: e.label }));
  const selectedExercice = picked.selected
    ? {
        id: picked.selected.id,
        dateStart: iso(picked.selected.dateStart),
        dateEnd: iso(picked.selected.dateEnd),
      }
    : null;

  // « L'exercice définit la plage » : bornes = celles de l'exercice, sauf from/to manuels
  // (affinage à l'intérieur de l'exercice).
  const dateFrom = rawFrom ?? selectedExercice?.dateStart ?? null;
  const dateTo = rawTo ?? selectedExercice?.dateEnd ?? null;

  const stats = await getServiceStats(id, { type, dateFrom, dateTo });

  // Raccourci « Période » : périodes de l'exercice sélectionné uniquement.
  const periods = periodRows
    .filter((p) => p.exerciceId === selectedExercice?.id)
    .map((p) => ({
      id: p.id,
      label: p.label,
      dateStart: iso(p.dateStart),
      dateEnd: iso(p.dateEnd),
    }));

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
        dateFrom={rawFrom ?? ""}
        dateTo={rawTo ?? ""}
        periods={periods}
        exercices={exercices.map((e) => ({ id: e.id, label: e.label }))}
        selectedExerciceId={selectedExercice?.id ?? null}
      />

      {/* Bandeau KPIs */}
      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <MetricCard value={stats.total} label="Séances" sub={`${moyParUsager} / usager`} />
        <MetricCard value={stats.distinctUsers} label="Usagers distincts" color="#5ab4e8" />
        <MetricCard
          value={stats.enfants}
          label="Enfants"
          color="#e8a45a"
          sub={`${moyEnfants} / séance`}
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
        {stats.tauxAbsence != null && (
          <MetricCard
            value={`${stats.tauxAbsence}%`}
            label="Taux d'absence"
            color={C_ABSENT}
            hint="Absents / (présents + absents), séances pointées"
          />
        )}
        {stats.pending > 0 && (
          <MetricCard value={stats.pending} label="Demandes en attente" color="var(--warn)" />
        )}
      </div>

      {/* Grille unique : anneaux (5, ou 4 sans présence) PUIS panneaux — tout s'enchaîne
          sur 4 colonnes, sans colonne vide entre les deux sections. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: ".85rem",
        }}
      >
        {stats.prevu > 0 && (
          <DonutPanel
            title="Présence — séances passées ou pointées"
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
          centerValue={String(stats.recurringCount + stats.uniqueCount)}
          centerLabel="séances"
        />

        <DonutPanel
          title="Répartition par jour"
          data={forDonut(stats.byDay, 6)}
          centerValue={peakDay ? peakDay.label : "—"}
          centerLabel="jour fort"
          centerValueSize=".95rem"
        />

        <DonutPanel
          title="Top structures"
          data={forDonut(stats.topStructures, 5)}
          centerValue={String(stats.distinctUsers)}
          centerLabel="usagers"
        />

        <DonutPanel
          title="Répartition par thème"
          data={forDonut(stats.topThemes, 6)}
          centerValue={String(stats.themedCount)}
          centerLabel="séances"
        />

        <Panel
          title="Évolution mensuelle"
          hint="Nombre de séances par mois"
          empty={stats.byMonth.length === 0}
        >
          <AreaChart data={stats.byMonth} color="#e8a45a" />
        </Panel>

        <Panel title="Remplissage moyen par mois (séances)" empty={stats.fillByMonth.length === 0}>
          <FillCurve data={stats.fillByMonth} color="#e8a45a" />
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
              labelAbove
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
      </div>
    </div>
  );
}
