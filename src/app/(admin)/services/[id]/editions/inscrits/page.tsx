import { notFound } from "next/navigation";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { type Inscrit, listInscrits } from "@/server/services/editions";
import { AnonymisesToggle } from "../anonymises-toggle";
import { ExerciceNav } from "../exercice-nav";
import { ExportButton } from "../export-button";
import { PrintButton } from "../print-button";
import { resolveEditionExercice } from "../range";

export const metadata = { title: "CultuRésa — Inscrits" };

// Édition « Liste des inscrits » : les usagers distincts ayant réservé sur l'exercice
// sélectionné — identité, structure, niveau et contact. Volontairement SANS plage
// hebdo/mensuelle ni ruptures (un inscrit se compte par exercice, pas par semaine) :
// l'en-tête se limite à « ← Éditions », la navigation d'exercice et l'impression PDF.
export default async function EditionsInscritsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string; anonymises?: string; tri?: string; dir?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  // Comptes anonymisés (RGPD) exclus par défaut ; case « afficher… » → anonymises=1.
  const withAnonymized = sp.anonymises === "1";
  const inscrits = await listInscrits(id, selected?.periodIds, withAnonymized);

  // Tri par clic sur les en-têtes : `tri` (colonne) + `dir` (asc par défaut), portés
  // par l'URL — conservés par la navigation d'exercice (ExerciceNav garde les autres
  // paramètres) et transmis au PDF (même vue imprimée). Défaut = identité.
  const SORT_KEYS = ["identite", "structure", "niveau", "email", "tel", "inscription"] as const;
  type SortKey = (typeof SORT_KEYS)[number];
  const tri: SortKey = (SORT_KEYS as readonly string[]).includes(sp.tri ?? "")
    ? (sp.tri as SortKey)
    : "identite";
  const dir = sp.dir === "desc" ? "desc" : "asc";
  // Valeur triée = la valeur AFFICHÉE (structure avec repli demandeur, date en
  // YYYY-MM-DD) ; départage identité pour un ordre stable.
  const valOf = (u: Inscrit): string =>
    tri === "identite"
      ? `${u.nom} ${u.prenom}`
      : tri === "structure"
        ? u.structure || u.demandeur
        : tri === "inscription"
          ? u.inscritYmd
          : u[tri];
  inscrits.sort(
    (a, b) =>
      (valOf(a).localeCompare(valOf(b), "fr", { sensitivity: "base" }) ||
        a.nom.localeCompare(b.nom) ||
        a.prenom.localeCompare(b.prenom)) * (dir === "desc" ? -1 : 1),
  );

  // Lien d'un en-tête : re-clic sur la colonne active → inversion du sens.
  const sortHref = (k: SortKey) => {
    const p = new URLSearchParams();
    if (selected) p.set("exercice", String(selected.id));
    if (withAnonymized) p.set("anonymises", "1");
    p.set("tri", k);
    if (k === tri && dir === "asc") p.set("dir", "desc");
    return `?${p.toString()}`;
  };
  const arrow = (k: SortKey) => (k === tri ? (dir === "asc" ? " ▲" : " ▼") : "");
  const thLink: React.CSSProperties = { color: "inherit", textDecoration: "none" };

  const viewParams = `${selected ? `&exercice=${selected.id}` : ""}${
    withAnonymized ? "&anonymises=1" : ""
  }`;
  const pdfHref = `/services/${id}/editions/pdf?kind=inscrits${viewParams}&tri=${tri}${
    dir === "desc" ? "&dir=desc" : ""
  }`;
  const csvHref = `/services/${id}/editions/export?kind=inscrits${viewParams}`;

  const linkBtn: React.CSSProperties = {
    fontSize: ".7rem",
    padding: "3px 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
  const tdNoWrap: React.CSSProperties = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  return (
    <div>
      {/* En-tête façon RangeBar, sans sélecteur de plage : retour, titre centré
          (navigation d'exercice intégrée), impression PDF à droite. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          minHeight: "2rem",
          marginBottom: "1rem",
        }}
      >
        <a href={`/services/${id}/editions`} className="no-print" style={linkBtn}>
          ← Éditions
        </a>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: ".5rem",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Liste des inscrits
          <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
          <span className="print-only">- {service.label}</span>
        </div>
        <div
          className="no-print"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".6rem" }}
        >
          <AnonymisesToggle />
          <ExportButton href={csvHref} />
          <PrintButton iconOnly href={pdfHref} title="Imprimer (PDF)" />
        </div>
      </div>

      {inscrits.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>Aucun inscrit sur cet exercice.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: "19%" }}>
                    <a href={sortHref("identite")} style={thLink}>
                      Identité{arrow("identite")}
                    </a>
                  </th>
                  <th style={{ width: "22%" }}>
                    <a href={sortHref("structure")} style={thLink}>
                      Structure{arrow("structure")}
                    </a>
                  </th>
                  <th style={{ width: 70 }}>
                    <a href={sortHref("niveau")} style={thLink}>
                      Niveau{arrow("niveau")}
                    </a>
                  </th>
                  <th style={{ width: "24%" }}>
                    <a href={sortHref("email")} style={thLink}>
                      Mail{arrow("email")}
                    </a>
                  </th>
                  <th style={{ width: 80 }}>
                    <a href={sortHref("tel")} style={thLink}>
                      Tél{arrow("tel")}
                    </a>
                  </th>
                  <th style={{ width: 60 }}>
                    <a href={sortHref("inscription")} style={thLink}>
                      Inscrit le{arrow("inscription")}
                    </a>
                  </th>
                </tr>
              </thead>
              <tbody>
                {inscrits.map((u, i) => (
                  <tr key={`${u.email}-${i}`}>
                    <td style={{ ...tdNoWrap, fontWeight: 600 }}>
                      {`${u.nom} ${u.prenom}`.trim() || "—"}
                    </td>
                    <td style={tdNoWrap}>{u.structure || u.demandeur || "—"}</td>
                    <td style={tdNoWrap}>{u.niveau || "—"}</td>
                    <td style={tdNoWrap}>{u.email || "—"}</td>
                    <td style={tdNoWrap}>{formatTel(u.tel)}</td>
                    <td style={tdNoWrap}>{u.inscritLe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: ".8rem", fontWeight: 600, margin: ".6rem 0 0" }}>
            {inscrits.length} inscrit{inscrits.length > 1 ? "s" : ""}
          </p>
        </>
      )}
    </div>
  );
}
