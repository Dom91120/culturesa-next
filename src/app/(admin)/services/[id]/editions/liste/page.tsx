import { AdminDemInfo } from "@/components/admin-dem-info";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import {
  type DatedSession,
  type EditionRow,
  type SessionAttendee,
  listDatedSessions,
  listEditionRows,
} from "@/server/services/editions";
import { notFound } from "next/navigation";
import { PrintButton } from "../print-button";
import {
  bucketSessions,
  computeRowTotals,
  computeTotals,
  fetchEditionPeriods,
  resolveRange,
  sortRowsAlpha,
} from "../range";
import { RangeBar } from "../range-bar";
import { ListeTotalsLine, RuptureHeading, TotalsLine } from "../totals";
import { ListeSortSelect } from "./liste-controls";

const POINTAGE_LABEL: Record<string, string> = { present: "Présent", absent: "Absent" };
const PER_PAGE = 20;

// Édition « Liste des réservations » :
//   • Alphabétique → une ligne par RÉSERVATION, triée Nom/Prénom, paginée (20/page) + total.
//   • Par date → les OCCURRENCES datées (vue Hebdo/Mensuel/Période), avec ruptures
//     (semaine/mois) et sous-totaux, comme Plannings/Pointages.
export default async function EditionsListePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tri?: string;
    mode?: string;
    date?: string;
    week?: string;
    periodId?: string;
    page?: string;
    ruptures?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tri = sp.tri === "alpha" ? "alpha" : "date";

  const [service, demRows] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    getServiceDemandeurSettingsLabeled(id),
  ]);
  if (!service) notFound();

  const linkBtn: React.CSSProperties = {
    fontSize: ".7rem",
    padding: "3px 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
  };
  const navBtn: React.CSSProperties = { ...linkBtn, padding: "3px 9px", fontSize: ".8rem" };

  // Barre de pagination (20 lignes/page).
  const pager = (page: number, pages: number, total: number, href: (n: number) => string) =>
    pages > 1 ? (
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
          <a href={href(page - 1)} style={navBtn} aria-label="Page précédente">
            ◀
          </a>
        ) : (
          <span style={{ ...navBtn, opacity: 0.4 }}>◀</span>
        )}
        <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
          Page {page} / {pages} · {total} ligne{total > 1 ? "s" : ""}
        </span>
        {page < pages ? (
          <a href={href(page + 1)} style={navBtn} aria-label="Page suivante">
            ▶
          </a>
        ) : (
          <span style={{ ...navBtn, opacity: 0.4 }}>▶</span>
        )}
      </div>
    ) : null;

  // ── Vue ALPHABÉTIQUE : réservations triées Nom/Prénom, paginées ──
  if (tri === "alpha") {
    const rows = sortRowsAlpha(await listEditionRows(id));
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
    const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const pageHref = (n: number) => `/services/${id}/editions/liste?tri=alpha&page=${n}`;

    return (
      <div>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <a href={`/services/${id}/editions`} className="no-print" style={linkBtn}>
            ← Éditions
          </a>
          <div className="agenda-mode-toggles-wrap no-print" style={{ marginLeft: "auto" }}>
            <ListeSortSelect serviceId={id} tri={tri} />
            <PrintButton iconOnly />
          </div>
        </div>

        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
          Liste des réservations — {service.label}
        </h2>

        {rows.length === 0 ? (
          <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
            Aucune réservation pour ce service.
          </p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Période</th>
                    <th>Jour / Date</th>
                    <th>Créneau</th>
                    <th>Demandeur</th>
                    <th>Nom</th>
                    <th>Prénom</th>
                    <th>Thème</th>
                    <th>Enfants</th>
                    <th>Statut</th>
                    <th>Pointage</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.periode}</td>
                      <td>{r.jour}</td>
                      <td>
                        {r.debut}–{r.fin}
                      </td>
                      <td>{r.demandeur || "—"}</td>
                      <td style={{ fontWeight: 600 }}>{r.nom || "—"}</td>
                      <td>{r.prenom || "—"}</td>
                      <td>{r.theme || "—"}</td>
                      <td>{r.enfants}</td>
                      <td>
                        <span
                          className={`role-pill ${r.statut === "Réservation validée" ? "role-utilisateur" : "role-gestionnaire"}`}
                        >
                          {r.statut}
                        </span>
                      </td>
                      <td>{r.pointage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pager(page, pages, rows.length, pageHref)}
            {page === pages && (
              <ListeTotalsLine label="Total général" totals={computeRowTotals(rows)} strong />
            )}
          </>
        )}

        <AdminDemInfo rows={demRows} />
      </div>
    );
  }

  // ── Vue PAR DATE : occurrences datées (Hebdo / Mensuel / Période) + ruptures ──
  const periods = await fetchEditionPeriods(id);
  const range = resolveRange(id, "liste", sp, periods);
  const sessions = await listDatedSessions(id, range.fromYmd, range.toYmd);
  // Ruptures (case « avec ruptures ») OFF par défaut → un seul bloc sans sous-total.
  const withRuptures = sp.ruptures === "1";
  const buckets = withRuptures
    ? bucketSessions(range.mode, sessions)
    : sessions.length > 0
      ? [{ key: "all", label: "", sessions }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  // Lignes plates (1 par participant d'occurrence) + index global, pour paginer (20/page).
  type OccRow = { gi: number; bucketKey: string; s: DatedSession; a: SessionAttendee };
  const flat: OccRow[] = [];
  const bucketInfo = new Map<
    string,
    { label: string; first: number; last: number; sessions: DatedSession[] }
  >();
  for (const b of buckets) {
    for (const s of b.sessions) {
      for (const a of s.attendees) {
        const gi = flat.length;
        flat.push({ gi, bucketKey: b.key, s, a });
        const info = bucketInfo.get(b.key);
        if (info) info.last = gi;
        else bucketInfo.set(b.key, { label: b.label, first: gi, last: gi, sessions: b.sessions });
      }
    }
  }

  const pages = Math.max(1, Math.ceil(flat.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageRows = flat.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Groupes consécutifs (même rupture) dans la page courante.
  const groups: { key: string; rows: OccRow[] }[] = [];
  for (const f of pageRows) {
    const last = groups[groups.length - 1];
    if (last && last.key === f.bucketKey) last.rows.push(f);
    else groups.push({ key: f.bucketKey, rows: [f] });
  }

  // Lien de page (conserve vue / plage / ruptures).
  const pageParams = new URLSearchParams({ tri: "date", mode: range.mode });
  if (range.mode === "period" && range.periodId) pageParams.set("periodId", String(range.periodId));
  else pageParams.set("date", range.dateParam);
  if (withRuptures) pageParams.set("ruptures", "1");
  const dateHref = (n: number) =>
    `/services/${id}/editions/liste?${pageParams.toString()}&page=${n}`;

  const renderOccRows = (rows: OccRow[]) => (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Créneau</th>
            <th>Demandeur</th>
            <th>Nom</th>
            <th>Prénom</th>
            <th>Thème</th>
            <th>Enfants</th>
            <th>Pointage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ gi, s, a }) => (
            <tr key={gi}>
              <td>
                {s.dayLabel} {s.dateLabel}
              </td>
              <td>
                {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
              </td>
              <td>{a.demandeur || "—"}</td>
              <td style={{ fontWeight: 600 }}>{a.nom || "—"}</td>
              <td>{a.prenom || "—"}</td>
              <td>{a.theme || "—"}</td>
              <td>{a.enfants}</td>
              <td>{a.pointage ? POINTAGE_LABEL[a.pointage] : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <RangeBar
        serviceId={id}
        screen="liste"
        range={range}
        extra={<ListeSortSelect serviceId={id} tri={tri} />}
        ruptures={withRuptures}
      />

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        Liste des réservations — {service.label}
      </h2>

      {flat.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune occurrence sur cette période.
        </p>
      ) : (
        <>
          {groups.map((g) => {
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
                {renderOccRows(g.rows)}
                {withSubtotals && endsHere && info && (
                  <TotalsLine
                    label={`Sous-total — ${label}`}
                    totals={computeTotals(info.sessions)}
                    variant="planning"
                  />
                )}
              </div>
            );
          })}

          {pager(page, pages, flat.length, dateHref)}

          {/* Total général sur la dernière page (cumul de toute la plage). */}
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
