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
import { computeTotals, resolveEditionExercice, resolveRange } from "../range";
import { RangeBar } from "../range-bar";
import { TotalsLine } from "../totals";

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
// (Hebdomadaire / Mensuel / Trimestriel / Annuel), TRIABLES par colonne, paginées + total.
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

  const flat: OccRow[] = sessions.flatMap((s) => s.attendees.map((a) => ({ s, a })));
  flat.sort((x, y) => {
    const vx = sortValue(x, sortKey);
    const vy = sortValue(y, sortKey);
    let c =
      typeof vx === "number" && typeof vy === "number"
        ? vx - vy
        : String(vx).localeCompare(String(vy));
    if (c === 0) c = `${x.a.nom} ${x.a.prenom}`.localeCompare(`${y.a.nom} ${y.a.prenom}`);
    return dir === "desc" ? -c : c;
  });

  const pages = Math.max(1, Math.ceil(flat.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageRows = flat.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Base d'URL : conserve exercice + plage courante (mode/date/trim).
  const baseParams = () => {
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    p.set("mode", range.mode);
    if (range.mode === "week" || range.mode === "month") p.set("date", range.dateParam);
    if (range.mode === "trimester" && range.trimIndex != null)
      p.set("trim", String(range.trimIndex));
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

  return (
    <div>
      <RangeBar
        serviceId={id}
        screen="liste"
        range={range}
        exportHref={`/services/${id}/editions/export${selected ? `?exercice=${selected.id}` : ""}`}
        exercices={exercices}
        selectedExerciceId={selected?.id ?? null}
        showRuptures={false}
      />

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        Liste des réservations — {service.label}
      </h2>

      {flat.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune réservation sur cette période.
        </p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 1080 }}>
              <thead>
                <tr>
                  {COLS.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        ...thBase,
                        width: col.width,
                        textAlign: col.center ? "center" : "left",
                      }}
                    >
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
                {pageRows.map(({ s, a }, i) => (
                  <tr key={`${s.date}-${s.startTime}-${a.nom}-${a.prenom}-${i}`}>
                    <td style={tdNoWrap}>
                      {s.dayLabel} {s.dateLabel}
                    </td>
                    <td style={tdNoWrap}>
                      {s.startTime && s.endTime
                        ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
                        : "Journée entière"}
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
        </>
      )}

      <AdminDemInfo rows={demRows} />
    </div>
  );
}
