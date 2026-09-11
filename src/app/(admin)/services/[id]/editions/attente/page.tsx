import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { listWaitingEntries } from "@/server/services/waiting-list";
import { EditionSummary, Who } from "../edition-header";
import { isoDateLabel, muted, tdNoWrap, WaitlistEditionHeader, ymdLabel } from "./header";

export const metadata = { title: "CultuRésa — Liste d'attente" };

// Édition « Liste d'attente en cours » : les inscrits du jour, dans l'ordre d'inscription
// (rang), avec disponibilités, périodes souhaitées, option automatique, dates et échéance.
// État du jour : pas de navigation d'exercice.
export default async function EditionsAttentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();
  const rows = await listWaitingEntries(id);
  const auto = rows.filter((r) => r.autoInscription).length;

  return (
    <div className="panel ed-screen">
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Liste d'attente en cours"
        csvHref={`/services/${id}/editions/export?kind=attente`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente`}
      />
      {rows.length === 0 ? (
        <p className="ed-empty">Aucun inscrit sur la liste d'attente.</p>
      ) : (
        <>
          <EditionSummary
            pills={[
              { text: `${rows.length} inscrit${rows.length > 1 ? "s" : ""}`, tone: "warn" },
              ...(auto > 0
                ? [{ text: `${auto} en réservation automatique`, tone: "ok" as const }]
                : []),
            ]}
          />
          <div className="ed-table-wrap">
            <table className="ed-table" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th style={{ width: "18%" }}>Usager</th>
                  <th style={{ width: "15%" }}>Structure</th>
                  <th style={{ width: "18%" }}>Disponibilités</th>
                  <th style={{ width: "16%" }}>Périodes souhaitées</th>
                  <th style={{ width: 46, textAlign: "center" }}>Auto</th>
                  {/* Deux dates empilées dans une seule colonne, comme l'historique. */}
                  <th style={{ width: 88, lineHeight: 1.2 }}>
                    Inscrit le
                    <br />
                    Prévenu le
                  </th>
                  <th style={{ width: 88 }}>Échéance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ color: "var(--muted)" }}>{i + 1}</td>
                    <td style={tdNoWrap}>
                      <Who nom={r.nom} prenom={r.prenom} email={r.email} sub={r.email} />
                    </td>
                    <td style={{ lineHeight: 1 }}>{r.structure || r.demandeur || "—"}</td>
                    {/* Listes longues : corps réduit et interligne simple (comme l'historique). */}
                    <td style={{ fontSize: ".66rem", lineHeight: 1 }}>
                      {r.dispos.join(", ") || "—"}
                    </td>
                    <td style={{ fontSize: ".66rem", lineHeight: 1 }}>
                      {r.periodes.join(", ") || "Toutes"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {r.autoInscription ? <span className="ms-pill is-ok">auto</span> : "—"}
                    </td>
                    <td style={{ ...tdNoWrap, lineHeight: 1.2 }}>
                      {isoDateLabel(r.createdAt)}
                      <br />
                      <span style={muted}>{isoDateLabel(r.lastNotifiedAt)}</span>
                    </td>
                    <td style={tdNoWrap}>{ymdLabel(r.echeance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
