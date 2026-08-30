import { notFound } from "next/navigation";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { listInscrits } from "@/server/services/editions";
import { AnonymisesToggle } from "../anonymises-toggle";
import { ExerciceNav } from "../exercice-nav";
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
  searchParams: Promise<{ exercice?: string; anonymises?: string }>;
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

  const pdfHref = `/services/${id}/editions/pdf?kind=inscrits${
    selected ? `&exercice=${selected.id}` : ""
  }${withAnonymized ? "&anonymises=1" : ""}`;

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
          <PrintButton iconOnly href={pdfHref} title="Imprimer (PDF)" />
        </div>
      </div>

      {inscrits.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucun inscrit sur cet exercice.
        </p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Identité</th>
                  <th style={{ width: "26%" }}>Structure</th>
                  <th style={{ width: "12%" }}>Niveau</th>
                  <th style={{ width: "26%" }}>Mail</th>
                  <th style={{ width: "14%" }}>Tél</th>
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
