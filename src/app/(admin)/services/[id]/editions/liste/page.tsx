import { notFound } from "next/navigation";
import { CheckGlyph } from "@/app/(admin)/users/account-ui";
import { AdminDemInfo } from "@/components/admin-dem-info";
import { HourglassGlyph, ListDetailsGlyph } from "@/components/ui-glyphs";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import {
  type DatedSession,
  listDatedSessions,
  pointageCell,
  type SessionAttendee,
} from "@/server/services/editions";
import {
  bucketSessions,
  computeTotals,
  rangeSearchParams,
  resolveEditionExercice,
  resolveRange,
} from "../range";
import { RangeBar } from "../range-bar";
import { RuptureHeading, TotalsLine } from "../totals";

// Pagination à la feuille (Dom 2026-09-09) : calée sur le PDF A4 paysage, qui tient
// une quinzaine de lignes à deux niveaux (date + créneau, nom + contact) par page.
const PER_PAGE = 15;

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
  // Largeurs (Dom 2026-09-09) : date et créneau entiers, identité avec le contact dessous.
  { key: "date", label: "Date", width: "16%" },
  { key: "demandeur", label: "Demandeur", width: "18%" },
  { key: "identite", label: "Identité", width: "26%" },
  { key: "theme", label: "Thème", width: "16%" },
  { key: "participants", label: "Partic.", width: "6%", center: true },
  { key: "statut", label: "Statut", width: "5%", center: true },
  { key: "pointage", label: "Pointage", width: "13%", center: true },
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
// groupe. Paginée à la feuille (cf. PER_PAGE) + total général.
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
  const allGroups = groupBy(flat);

  // Base d'URL : conserve exercice + plage (mode/date/trim) + ruptures — source
  // unique rangeSearchParams (editions/range), le tri s'ajoute par lien.
  const baseParams = () => rangeSearchParams(range, selected?.id ?? null, withRuptures);
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
  // Impression = PDF serveur (Puppeteer) : même vue (plage/tri/ruptures), titre courant + n° de page.
  const pdfParams = baseParams();
  pdfParams.set("sort", sortKey);
  pdfParams.set("dir", dir);
  pdfParams.set("kind", "liste");
  const pdfHref = `/services/${id}/editions/pdf?${pdfParams.toString()}`;

  const thBase: React.CSSProperties = { whiteSpace: "nowrap" };
  const tdNoWrap: React.CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const tdCenter: React.CSSProperties = { textAlign: "center", whiteSpace: "nowrap" };

  const renderRows = (rows: FlatRow[]) => (
    <div className="ed-table-wrap">
      <table className="ed-table" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            {COLS.map((col) => (
              <th
                key={col.key}
                className={sortKey === col.key ? "is-on" : undefined}
                style={{ ...thBase, width: col.width, textAlign: col.center ? "center" : "left" }}
              >
                <a href={sortHref(col.key)} className="ed-sort" title="Trier par cette colonne">
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
              {/* Date, créneau en sous-ligne (Dom 2026-09-09). */}
              <td style={tdNoWrap}>
                {s.dayLabel} {s.dateLabel}
                <span className="ed-sub">
                  {s.startTime && s.endTime
                    ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
                    : "Journée entière"}
                </span>
              </td>
              <td style={tdNoWrap}>{a.demandeur || "—"}</td>
              <td style={tdNoWrap}>
                <span style={{ fontWeight: 600 }}>{`${a.nom} ${a.prenom}`.trim() || "—"}</span>
                {/* Contact sous le nom (Dom 2026-09-09) ; rien pour un compte anonymisé. */}
                {`${a.nom}${a.prenom}`.trim() !== "" && (a.email || a.tel) && (
                  <span className="ed-sub">
                    {[a.email, formatTel(a.tel)].filter((x) => x && x !== "—").join(" · ")}
                  </span>
                )}
              </td>
              <td style={tdNoWrap}>{a.theme || "—"}</td>
              <td style={tdCenter}>
                {a.enfants} + {a.accompagnants}
              </td>
              <td style={tdCenter}>
                {/* Statut en pictogramme (Dom 2026-09-09) : coche verte « Validée », sablier
                    orange « En attente » ; libellé en infobulle et pour les lecteurs d'écran. */}
                <span
                  className={`rg-ico ${a.statut === "Validée" ? "is-ok" : "is-warn"}`}
                  title={a.statut}
                  aria-label={a.statut}
                  role="img"
                  style={{ width: 22, height: 22 }}
                >
                  {a.statut === "Validée" ? (
                    <CheckGlyph size={14} strokeWidth={2.6} />
                  ) : (
                    <HourglassGlyph size={13} />
                  )}
                </span>
              </td>
              <td style={tdCenter}>
                {pointageCell(a.pointage, a.absencePrevenue) || "—"}
                {/* Motif d'absence (prévenue ou constatée) en sous-ligne (Dom 2026-09-09). */}
                {(a.pointage === "absent" || (!a.pointage && a.absencePrevenue)) &&
                  a.pointageMotif.trim() !== "" && (
                    <span className="ed-sub ed-nowrap" title={a.pointageMotif}>
                      {a.pointageMotif}
                    </span>
                  )}
              </td>
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
    <div className="panel ed-screen">
      <RangeBar
        serviceId={id}
        serviceLabel={service.label}
        screen="liste"
        range={range}
        ruptures={withRuptures}
        exportHref={`/services/${id}/editions/export${selected ? `?exercice=${selected.id}` : ""}`}
        pdfHref={pdfHref}
        selectedExerciceId={selected?.id ?? null}
        exercices={exercices}
        title="Liste des réservations"
        icon={<ListDetailsGlyph size={16} />}
        tone="info"
      />

      {flat.length === 0 ? (
        <p className="ed-empty">Aucune réservation sur cette période.</p>
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
                  <a href={pageHref(page - 1)} className="acct-action" aria-label="Page précédente">
                    ‹
                  </a>
                ) : (
                  <span className="acct-action is-off">‹</span>
                )}
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  Feuille {page} / {pages} · {flat.length} ligne{flat.length > 1 ? "s" : ""}
                </span>
                {page < pages ? (
                  <a href={pageHref(page + 1)} className="acct-action" aria-label="Page suivante">
                    ›
                  </a>
                ) : (
                  <span className="acct-action is-off">›</span>
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

          {/* Impression (PDF Puppeteer) : liste COMPLÈTE en un seul flux — le <thead> de
              chaque tableau répète les en-têtes à chaque page ; Puppeteer ajoute le titre
              courant et le pied « Page X / N ». Masquée à l'écran. */}
          <div className="print-block-only">
            {renderGroups(allGroups)}
            <TotalsLine
              label="Total général"
              totals={computeTotals(sessions)}
              variant="planning"
              strong
            />
          </div>
        </>
      )}

      <AdminDemInfo rows={demRows} />
    </div>
  );
}
