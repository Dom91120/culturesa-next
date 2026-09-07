import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { listWaitingHistory } from "@/server/services/waiting-list-editions";
import { muted, tdNoWrap, WaitlistEditionHeader } from "../attente/header";
import { resolveEditionExercice } from "../range";

export const metadata = { title: "CultuRésa — Historique de la liste d'attente" };

// Édition « Historique des inscriptions » : toutes les inscriptions closes dont la date
// d'inscription tombe dans l'exercice sélectionné — issue, délai, réservation obtenue.
// À lire en fin de période / d'exercice : c'est le détail nominatif de la demande non
// satisfaite (« sans place ») et des placements.
export default async function EditionsAttenteHistoriquePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;
  const rows = await listWaitingHistory(
    id,
    selected ? { from: selected.dateStart, to: selected.dateEnd } : undefined,
  );
  const q = selected ? `&exercice=${selected.id}` : "";
  const sansPlace = rows.filter(
    (r) => r.issue === "EXPIRED" || r.issue === "LEFT" || r.issue === "REMOVED",
  ).length;
  const places = rows.filter((r) => r.issue === "AUTO_BOOKED" || r.issue === "BOOKED").length;

  return (
    <div>
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Historique de la liste d'attente"
        exercices={exercices}
        selectedId={selected?.id ?? null}
        csvHref={`/services/${id}/editions/export?kind=attente-historique${q}`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente-historique${q}`}
      />
      {rows.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucune inscription close sur cet exercice.
        </p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 1180 }}>
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>Usager</th>
                  <th style={{ width: "12%" }}>Structure</th>
                  <th style={{ width: "13%" }}>Disponibilités</th>
                  <th style={{ width: "12%" }}>Périodes</th>
                  <th style={{ width: 44, textAlign: "center" }}>Auto</th>
                  <th style={{ width: 96 }}>Inscrit le</th>
                  <th style={{ width: 96 }}>Clos le</th>
                  <th style={{ width: 54, textAlign: "right" }}>Délai</th>
                  <th style={{ width: "14%" }}>Issue</th>
                  <th style={{ width: "14%" }}>Réservation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdNoWrap}>
                      <div style={{ fontWeight: 600 }}>{r.usager || "—"}</div>
                      {r.email && <div style={muted}>{r.email}</div>}
                    </td>
                    <td style={tdNoWrap}>{r.structure || "—"}</td>
                    <td>{r.dispos.join(", ") || "—"}</td>
                    <td>{r.periodes.join(", ") || "Toutes"}</td>
                    <td style={{ textAlign: "center" }}>{r.autoInscription ? "Oui" : "—"}</td>
                    <td style={tdNoWrap}>{r.inscritLe}</td>
                    <td style={tdNoWrap}>{r.clotureLe}</td>
                    <td style={{ textAlign: "right" }}>{r.delaiJours} j</td>
                    <td>{r.issueLabel}</td>
                    <td>
                      {r.reservation || "—"}
                      {r.suppression && (
                        <div style={{ ...muted, color: "var(--danger)" }}>{r.suppression}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: ".8rem", fontWeight: 600, margin: ".6rem 0 0" }}>
            {rows.length} inscription{rows.length > 1 ? "s" : ""} close
            {rows.length > 1 ? "s" : ""} — {places} placée{places > 1 ? "s" : ""}, {sansPlace} sans
            place
          </p>
        </>
      )}
    </div>
  );
}
