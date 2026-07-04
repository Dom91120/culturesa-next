import { notFound } from "next/navigation";
import { AdminDemInfo } from "@/components/admin-dem-info";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import {
  type DatedSession,
  listDatedSessions,
  POINTAGE_LABEL,
  type SessionAttendee,
} from "@/server/services/editions";
import { ExerciceNav } from "../exercice-nav";
import { bucketSessions, computeTotals, resolveEditionExercice, resolveRange } from "../range";
import { RangeBar } from "../range-bar";
import { RuptureHeading, TotalsLine } from "../totals";

const PER_PAGE = 20;

// Colonnes triables (clic sur l'en-tête → ?sort=<key>&dir=asc|desc).
type SortKey =
  | "date"
  | "creneau"
  | "demandeur"
  | "identite"
  | "theme"
  | "participants"
  | "statut"
  | "pointage";
const COLS: { key: SortKey; label: string; width: string; center?: boolean }[] = [
  { key: "date", label: "Date", width: "12%" },
  { key: "creneau", label: "Créneau", width: "9%" },
  { key: "demandeur", label: "Demandeur", width: "15%" },
  { key: "identite", label: "Identité", width: "17%" },
  { key: "theme", label: "Thème", width: "17%" },
  { key: "participants", label: "Participants", width: "10%", center: true },
  { key: "statut", label: "Statut", width: "11%" },
  { key: "pointage", label: "Pointage", width: "9%", center: true },
];
const SORT_KEYS = new Set<string>(COLS.map((c) => c.key));

type OccRow = { s: DatedSession; a: SessionAttendee };

/** Valeur de tri d'une occurrence pour une colonne (nombre pour Participants, sinon chaîne). */
function sortValue({ s, a }: OccRow, key: SortKey): string | number {
  switch (key) {
    case "date":
      return `${s.date} ${s.startTime}`;
    case "creneau":
      return s.startTime;
    case "demandeur":
      return a.demandeur;
    case "identite":
      return `${a.nom} ${a.prenom}`;
    case "theme":
      return a.theme;
    case "participants":
      return a.enfants + a.accompagnants;
    case "statut":
      return a.statut;
    case "pointage":
      return a.pointage ?? "";
  }
}

// Édition « Liste des réservations » : occurrences datées de la plage choisie
// (Hebdomadaire / Mensuel / Trimestriel / Annuel), TRIABLES par colonne. Case « avec
// ruptures » → regroupement (semaine/mois) + sous-totaux ; le tri s'applique dans chaque
// groupe. Paginée (20/page) + total général.
export default async function EditionsListePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    mode?: string;
    date?: string;
    week?: string;
    trim?: string;
    page?: string;
    ruptures?: string;
    exercice?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, demRows, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    getServiceDemandeurSettingsLabeled(id),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  const range = resolveRange(id, "liste", sp, selected, selected?.id);
  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd, selected?.periodIds);

  const sortKey: SortKey = SORT_KEYS.has(sp.sort ?? "") ? (sp.sort as SortKey) : "date";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  const cmp = (x: OccRow, y: OccRow) => {
    const vx = sortValue(x, sortKey);
    const vy = sortValue(y, sortKey);
    let c =
      typeof vx === "number" && typeof vy === "number"
        ? vx - vy
        : String(vx).localeCompare(String(vy));
    if (c === 0) c = `${x.a.nom} ${x.a.prenom}`.localeCompare(`${y.a.nom} ${y.a.prenom}`);
    return dir === "desc" ? -c : c;
  };

  // Ruptures OFF → un seul groupe ; ON → semaine/mois (via bucketSessions). Le tri par
  // colonne s'applique À L'INTÉRIEUR de chaque groupe.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions, range.trimestres)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  // Lignes plates (1 par participant d'occurrence), triées dans chaque groupe, + index global.
  type FlatRow = { gi: number; bucketKey: string; s: DatedSession; a: SessionAttendee };
  const flat: FlatRow[] = [];
  const bucketInfo = new Map<
    string,
    { label: string; first: number; last: number; sessions: DatedSession[] }
  >();
  for (const b of buckets) {
    const rows = b.sessions.flatMap((s) => s.attendees.map((a) => ({ s, a }))).sort(cmp);
    for (const r of rows) {
      const gi = flat.length;
      flat.push({ gi, bucketKey: b.key, s: r.s, a: r.a });
      const info = bucketInfo.get(b.key);
      if (info) info.last = gi;
      else bucketInfo.set(b.key, { label: b.label, first: gi, last: gi, sessions: b.sessions });
    }
  }

  const pages = Math.max(1, Math.ceil(flat.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageRows = flat.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Groupes consécutifs (même rupture). `groups` = page courante (écran) ; `allGroups` =
  // TOUTES les lignes (impression, qui ignore la pagination).
  const groupBy = (rows: FlatRow[]): { key: string; rows: FlatRow[] }[] => {
    const out: { key: string; rows: FlatRow[] }[] = [];
    for (const f of rows) {
      const last = out[out.length - 1];
      if (last && last.key === f.bucketKey) last.rows.push(f);
      else out.push({ key: f.bucketKey, rows: [f] });
    }
    return out;
  };
  const groups = groupBy(pageRows);

  // Base d'URL : conserve exercice + plage (mode/date/trim) + ruptures + tri.
  const baseParams = () => {
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    p.set("mode", range.mode);
    if (range.mode === "week" || range.mode === "month") p.set("date", range.dateParam);
    if (range.mode === "trimester" && range.trimIndex != null)
      p.set("trim", String(range.trimIndex));
    if (withRuptures) p.set("ruptures", "1");
    return p;
  };
  const sortHref = (key: SortKey) => {
    const p = baseParams();
    p.set("sort", key);
    p.set("dir", key === sortKey && dir === "asc" ? "desc" : "asc");
    return `/services/${id}/editions/liste?${p.toString()}`;
  };
  const pageHref = (n: number) => {
    const p = baseParams();
    p.set("sort", sortKey);
    p.set("dir", dir);
    p.set("page", String(n));
    return `/services/${id}/editions/liste?${p.toString()}`;
  };

  const navBtn: React.CSSProperties = {
    fontSize: ".8rem",
    padding: "3px 9px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
  };
  const thBase: React.CSSProperties = { whiteSpace: "nowrap" };
  const tdNoWrap: React.CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const tdCenter: React.CSSProperties = { textAlign: "center", whiteSpace: "nowrap" };

  const renderRows = (rows: FlatRow[]) => (
    <div className="admin-table-wrap">
      <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 1080 }}>
        <thead>
          <tr>
            {COLS.map((col) => (
              <th key={col.key} style={{ ...thBase, width: col.width, textAlign: "center" }}>
                <a
                  href={sortHref(col.key)}
                  className="no-print"
                  style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}
                  title="Trier par cette colonne"
                >
                  {col.label}
                  {sortKey === col.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ gi, s, a }) => (
            <tr key={gi}>
              <td style={tdNoWrap}>
                {s.dayLabel} <span className="pr-2l">{s.dateLabel}</span>
              </td>
              <td style={tdNoWrap}>
                {s.startTime && s.endTime ? (
                  <>
                    {s.startTime.slice(0, 5)}
                    <span className="pr-2l">–{s.endTime.slice(0, 5)}</span>
                  </>
                ) : (
                  "Journée entière"
                )}
              </td>
              <td style={tdNoWrap}>{a.demandeur || "—"}</td>
              <td style={{ ...tdNoWrap, fontWeight: 600 }}>
                {`${a.nom} ${a.prenom}`.trim() || "—"}
              </td>
              <td style={tdNoWrap}>{a.theme || "—"}</td>
              <td style={tdCenter}>
                {a.enfants} + {a.accompagnants}
              </td>
              <td style={tdNoWrap}>
                <span
                  className={`role-pill ${a.statut === "Validée" ? "role-utilisateur" : "role-gestionnaire"}`}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {a.statut}
                </span>
              </td>
              <td style={tdCenter}>{a.pointage ? POINTAGE_LABEL[a.pointage] : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Rendu d'une liste de groupes (ruptures) : en-tête + tableau + sous-total. Partagé par
  // l'affichage écran (page courante) et l'impression (liste complète).
  const renderGroups = (list: { key: string; rows: FlatRow[] }[]) =>
    list.map((g) => {
      const info = bucketInfo.get(g.key);
      const label = info?.label ?? "";
      const isContinuation = !!info && g.rows[0].gi > info.first;
      const endsHere = !!info && g.rows[g.rows.length - 1].gi === info.last;
      return (
        <div key={`${g.key}-${g.rows[0].gi}`}>
          {label && (
            <RuptureHeading>
              {label}
              {isContinuation ? " (suite)" : ""}
            </RuptureHeading>
          )}
          {renderRows(g.rows)}
          {withSubtotals && endsHere && info && (
            <TotalsLine
              label={`Sous-total — ${label}`}
              totals={computeTotals(info.sessions)}
              variant="planning"
            />
          )}
        </div>
      );
    });

  return (
    <div>
      <RangeBar
        serviceId={id}
        screen="liste"
        range={range}
        ruptures={withRuptures}
        exportHref={`/services/${id}/editions/export${selected ? `?exercice=${selected.id}` : ""}`}
        selectedExerciceId={selected?.id ?? null}
        title={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", fontWeight: 700 }}
          >
            Liste des réservations
            <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
            <span className="print-only">- {service.label}</span>
          </span>
        }
      />

      {flat.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune réservation sur cette période.
        </p>
      ) : (
        <>
          {/* Écran : page courante (paginée) — masquée à l'impression. */}
          <div className="no-print">
            {renderGroups(groups)}

            {pages > 1 && (
              <div
                className="no-print"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: ".75rem",
                  margin: ".75rem 0",
                }}
              >
                {page > 1 ? (
                  <a href={pageHref(page - 1)} style={navBtn} aria-label="Page précédente">
                    ◀
                  </a>
                ) : (
                  <span style={{ ...navBtn, opacity: 0.4 }}>◀</span>
                )}
                <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
                  Page {page} / {pages} · {flat.length} ligne{flat.length > 1 ? "s" : ""}
                </span>
                {page < pages ? (
                  <a href={pageHref(page + 1)} style={navBtn} aria-label="Page suivante">
                    ▶
                  </a>
                ) : (
                  <span style={{ ...navBtn, opacity: 0.4 }}>▶</span>
                )}
              </div>
            )}

            {page === pages && (
              <TotalsLine
                label="Total général"
                totals={computeTotals(sessions)}
                variant="planning"
                strong
              />
            )}
          </div>

          {/* Impression : liste COMPLÈTE paginée (20 lignes/page comme à l'écran), un saut
              de page entre chaque, n° de page en bas à droite. Masquée à l'écran. */}
          <div className="print-block-only">
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
              const rows = flat.slice((p - 1) * PER_PAGE, p * PER_PAGE);
              return (
                <div key={p} className="print-page">
                  {renderGroups(groupBy(rows))}
                  {p === pages && (
                    <TotalsLine
                      label="Total général"
                      totals={computeTotals(sessions)}
                      variant="planning"
                      strong
                    />
                  )}
                  <div className="print-page-num">
                    Page {p} / {pages}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <AdminDemInfo rows={demRows} />
    </div>
  );
}
