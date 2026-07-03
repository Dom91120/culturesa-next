import { notFound } from "next/navigation";
import { AdminDemInfo } from "@/components/admin-dem-info";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import { type EditionRow, listEditionRows } from "@/server/services/editions";
import { ExerciceSelect } from "../exercice-select";
import { ExportButton } from "../export-button";
import { PrintButton } from "../print-button";
import { computeRowTotals, resolveEditionExercice } from "../range";
import { ListeTotalsLine } from "../totals";

const PER_PAGE = 20;

// Colonnes triables de la liste des réservations. `key` = paramètre d'URL `?sort=`.
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

/** Valeur de tri d'une ligne pour une colonne (nombre pour Participants, sinon chaîne). */
function sortValue(r: EditionRow, key: SortKey): string | number {
  switch (key) {
    case "date":
      return r.jour;
    case "creneau":
      return r.debut;
    case "demandeur":
      return r.demandeur;
    case "identite":
      return `${r.nom} ${r.prenom}`;
    case "theme":
      return r.theme;
    case "participants":
      return r.enfants + r.accompagnants;
    case "statut":
      return r.statut;
    case "pointage":
      return r.pointage;
  }
}

// Édition « Liste des réservations » : une ligne par RÉSERVATION, triable par colonne
// (clic sur l'en-tête → ?sort=<col>&dir=asc|desc), paginée (20/page) + total.
export default async function EditionsListePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string; dir?: string; page?: string; exercice?: string }>;
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

  const sortKey: SortKey = SORT_KEYS.has(sp.sort ?? "") ? (sp.sort as SortKey) : "identite";
  const dir = sp.dir === "desc" ? "desc" : "asc";

  const rows = await listEditionRows(id, undefined, selected?.periodIds);
  const sorted = [...rows].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let c =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
    // Départage stable par identité (Nom, Prénom).
    if (c === 0) c = `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`);
    return dir === "desc" ? -c : c;
  });

  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageRows = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Href conservant exercice + tri courant.
  const buildHref = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    p.set("sort", sortKey);
    p.set("dir", dir);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/services/${id}/editions/liste?${p.toString()}`;
  };
  const pageHref = (n: number) => buildHref({ page: String(n) });
  // Lien d'en-tête : bascule asc↔desc sur la colonne cliquée, repart page 1.
  const sortHref = (key: SortKey) => {
    const nextDir = key === sortKey && dir === "asc" ? "desc" : "asc";
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    p.set("sort", key);
    p.set("dir", nextDir);
    return `/services/${id}/editions/liste?${p.toString()}`;
  };

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
  const thBase: React.CSSProperties = { whiteSpace: "nowrap" };
  const tdNoWrap: React.CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const tdCenter: React.CSSProperties = { textAlign: "center", whiteSpace: "nowrap" };

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
        <div
          className="agenda-mode-toggles-wrap no-print"
          style={{ marginLeft: "auto", alignItems: "center", gap: ".6rem" }}
        >
          <ExerciceSelect exercices={exercices} selectedId={selected?.id ?? null} />
          <ExportButton
            href={`/services/${id}/editions/export${selected ? `?exercice=${selected.id}` : ""}`}
          />
          <PrintButton iconOnly />
        </div>
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        Liste des réservations — {service.label}
      </h2>

      {sorted.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune réservation pour ce service.
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
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdNoWrap}>{r.jour}</td>
                    <td style={tdNoWrap}>
                      {r.debut && r.fin ? `${r.debut}–${r.fin}` : "Journée entière"}
                    </td>
                    <td style={tdNoWrap}>{r.demandeur || "—"}</td>
                    <td style={{ ...tdNoWrap, fontWeight: 600 }}>
                      {`${r.nom} ${r.prenom}`.trim() || "—"}
                    </td>
                    <td style={tdNoWrap}>{r.theme || "—"}</td>
                    <td style={tdCenter}>
                      {r.enfants} + {r.accompagnants}
                    </td>
                    <td style={tdNoWrap}>
                      <span
                        className={`role-pill ${r.statut === "Validée" ? "role-utilisateur" : "role-gestionnaire"}`}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {r.statut}
                      </span>
                    </td>
                    <td style={tdCenter}>{r.pointage || "—"}</td>
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
                Page {page} / {pages} · {sorted.length} ligne{sorted.length > 1 ? "s" : ""}
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
            <ListeTotalsLine label="Total général" totals={computeRowTotals(sorted)} strong />
          )}
        </>
      )}

      <AdminDemInfo rows={demRows} />
    </div>
  );
}
