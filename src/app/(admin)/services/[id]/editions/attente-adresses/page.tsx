import { notFound } from "next/navigation";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { listWaitingContacts } from "@/server/services/waiting-list-editions";
import { tdNoWrap, WaitlistEditionHeader, ymdLabel } from "../attente/header";

export const metadata = { title: "CultuRésa — Adresses des inscrits en liste d'attente" };

// Édition « Adresses des inscrits » : coordonnées des inscrits du jour (publipostage :
// prévenir d'une ouverture de créneau, d'une nouvelle période…), avec un bloc
// d'adresses e-mail prêt à coller dans une messagerie.
export default async function EditionsAttenteAdressesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();
  const rows = await listWaitingContacts(id);
  const emails = [...new Set(rows.map((r) => r.email).filter(Boolean))];

  return (
    <div>
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Adresses des inscrits en liste d'attente"
        csvHref={`/services/${id}/editions/export?kind=attente-adresses`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente-adresses`}
      />
      {rows.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucun inscrit sur la liste d'attente.
        </p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Identité</th>
                  <th style={{ width: "22%" }}>Structure</th>
                  <th style={{ width: "24%" }}>Mail</th>
                  <th style={{ width: 96 }}>Tél</th>
                  <th style={{ width: 96 }}>Inscrit le</th>
                  <th style={{ width: 96 }}>Échéance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...tdNoWrap, fontWeight: 600 }}>
                      {`${r.nom} ${r.prenom}`.trim() || "—"}
                    </td>
                    <td style={tdNoWrap}>{r.structure || "—"}</td>
                    <td style={tdNoWrap}>{r.email || "—"}</td>
                    <td style={tdNoWrap}>{formatTel(r.tel)}</td>
                    <td style={tdNoWrap}>{r.inscritLe}</td>
                    <td style={tdNoWrap}>{ymdLabel(r.echeance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: ".8rem", fontWeight: 600, margin: ".6rem 0 .8rem" }}>
            {rows.length} inscrit{rows.length > 1 ? "s" : ""}
          </p>
          {emails.length > 0 && (
            <div className="no-print">
              <div className="panel-title" style={{ marginBottom: ".4rem" }}>
                <span className="dot" />
                Adresses e-mail à copier
              </div>
              <textarea
                readOnly
                rows={Math.min(6, Math.ceil(emails.length / 3) + 1)}
                value={emails.join("; ")}
                style={{
                  width: "100%",
                  fontSize: ".78rem",
                  fontFamily: "inherit",
                  padding: ".5rem .6rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--surface1)",
                  color: "var(--text)",
                  resize: "vertical",
                }}
              />
              <p style={{ fontSize: ".72rem", color: "var(--muted)", margin: ".3rem 0 0" }}>
                Séparées par « ; » : à coller dans le champ « Cci » de votre messagerie.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
