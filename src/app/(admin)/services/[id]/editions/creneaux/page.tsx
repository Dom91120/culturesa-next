import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { listOpenSlots, type OpenSlot } from "@/server/services/editions";
import { ExerciceNav } from "../exercice-nav";
import { ExportButton } from "../export-button";
import { PrintButton } from "../print-button";
import { resolveEditionExercice } from "../range";
import { RupturesToggle } from "../ruptures-toggle";
import { RuptureHeading, TotalsBar } from "../totals";

export const metadata = { title: "CultuRésa — Créneaux ouverts" };

const plural = (n: number) => (n > 1 ? "s" : "");

// Libellé du groupe de rupture d'un créneau : la combinaison EXACTE de ses catégories
// (pas une ligne par catégorie — un créneau multi-catégories serait compté plusieurs
// fois et les sous-totaux ne s'additionneraient plus au total général).
const groupLabelOf = (s: OpenSlot) =>
  s.demandeurs.length === 0 ? "Toutes catégories" : s.demandeurs.join(", ");

// Total (ou sous-total) d'un ensemble de créneaux : compte, répartition récurrents /
// ponctuels, somme des places renseignées.
function totalsParts(rows: OpenSlot[]): string[] {
  const rec = rows.filter((r) => r.recurrent).length;
  const ponct = rows.length - rec;
  const places = rows.reduce((acc, r) => acc + (r.places ?? 0), 0);
  return [
    `${rows.length} créneau${rows.length > 1 ? "x" : ""} ouvert${plural(rows.length)}`,
    `${rec} récurrent${plural(rec)}`,
    `${ponct} ponctuel${plural(ponct)}`,
    ...(places > 0 ? [`${places} place${plural(places)}`] : []),
  ];
}

// Édition « Liste des créneaux ouverts » : l'OFFRE de réservation du service sur
// l'exercice sélectionné — une ligne par créneau configuré (récurrents et ponctuels,
// sans les miroirs), avec horaires, période, places et catégories de demandeurs.
// Volontairement SANS plage hebdo/mensuelle (l'offre se lit par exercice) ; la case
// « rupture par demandeur » regroupe par combinaison de catégories, avec sous-totaux.
export default async function EditionsCreneauxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string; ruptures?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;

  const rows = await listOpenSlots(id, selected?.periodIds);
  // Rupture par demandeur COCHÉE par défaut (param `ruptures=0` pour la décocher).
  const withRuptures = sp.ruptures == null ? true : sp.ruptures === "1";

  // Groupes de rupture : « Toutes les catégories » d'abord, puis ordre alphabétique.
  const groups = new Map<string, OpenSlot[]>();
  for (const r of rows) {
    const key = groupLabelOf(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const groupKeys = [...groups.keys()].sort((a, b) =>
    a === "Toutes catégories" ? -1 : b === "Toutes catégories" ? 1 : a.localeCompare(b),
  );
  const buckets = withRuptures
    ? groupKeys.map((k) => ({ key: k, label: k, rows: groups.get(k) ?? [] }))
    : rows.length > 0
      ? [{ key: "all", label: "", rows }]
      : [];
  const withSubtotals = withRuptures && buckets.length > 1;

  const pdfHref = `/services/${id}/editions/pdf?kind=creneaux${
    selected ? `&exercice=${selected.id}` : ""
  }&ruptures=${withRuptures ? "1" : "0"}`;
  const csvHref = `/services/${id}/editions/export?kind=creneaux${
    selected ? `&exercice=${selected.id}` : ""
  }`;

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
      {/* En-tête façon « Liste des inscrits » : retour, titre centré (navigation
          d'exercice intégrée), rupture par demandeur et impression PDF à droite. */}
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
          Liste des créneaux ouverts
          <ExerciceNav exercices={exercices} selectedId={selected?.id ?? null} />
          <span className="print-only">- {service.label}</span>
        </div>
        <div
          className="no-print"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".6rem" }}
        >
          <RupturesToggle label="rupture par demandeur" defaultOn />
          <ExportButton href={csvHref} />
          <PrintButton iconOnly href={pdfHref} title="Imprimer (PDF)" />
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucun créneau ouvert sur cet exercice.
        </p>
      ) : (
        <>
          {buckets.map((b) => (
            <div key={b.key}>
              {b.label && <RuptureHeading>{b.label}</RuptureHeading>}
              <div className="admin-table-wrap">
                <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "20%" }}>Jour / Date</th>
                      <th style={{ width: "15%" }}>Horaires</th>
                      <th style={{ width: "19%" }}>Type</th>
                      <th style={{ width: "19%" }}>Période</th>
                      <th style={{ width: "8%" }}>Places</th>
                      <th style={{ width: "19%" }}>Demandeurs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, i) => (
                      <tr key={`${b.key}-${i}`}>
                        <td style={{ ...tdNoWrap, fontWeight: 600 }}>{r.jour}</td>
                        <td style={tdNoWrap}>{r.creneau}</td>
                        <td style={tdNoWrap}>{r.type}</td>
                        <td style={tdNoWrap}>{r.periode}</td>
                        <td style={tdNoWrap}>{r.places ?? "—"}</td>
                        <td style={tdNoWrap}>
                          {r.demandeurs.length === 0
                            ? "Toutes catégories"
                            : r.demandeurs.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {withSubtotals && (
                <TotalsBar label={`Sous-total — ${b.label}`} parts={totalsParts(b.rows)} />
              )}
            </div>
          ))}
          <TotalsBar label="Total général" parts={totalsParts(rows)} strong />
        </>
      )}
    </div>
  );
}
