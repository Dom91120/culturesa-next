import { notFound } from "next/navigation";
import { MailGlyph } from "@/components/ui-glyphs";
import { formatTel } from "@/lib/format";
import { prisma } from "@/server/db";
import { listWaitingContacts } from "@/server/services/waiting-list-editions";
import { tdNoWrap, WaitlistEditionHeader, ymdLabel } from "../attente/header";
import { dash, EditionSummary, Who } from "../edition-header";

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
    <div className="panel ed-screen">
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Adresses des inscrits en liste d'attente"
        icon={<MailGlyph size={16} />}
        csvHref={`/services/${id}/editions/export?kind=attente-adresses`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente-adresses`}
      />
      {rows.length === 0 ? (
        <p className="ed-empty">Aucun inscrit sur la liste d'attente.</p>
      ) : (
        <>
          <EditionSummary
            pills={[
              { text: `${rows.length} inscrit${rows.length > 1 ? "s" : ""}`, tone: "warn" },
              { text: `${emails.length} adresse${emails.length > 1 ? "s" : ""} e-mail` },
            ]}
          />
          <div className="ed-table-wrap">
            <table className="ed-table" style={{ tableLayout: "fixed" }}>
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
                    <td style={tdNoWrap}>
                      <Who nom={r.nom} prenom={r.prenom} email={r.email} />
                    </td>
                    <td style={tdNoWrap}>{r.structure || dash}</td>
                    <td style={tdNoWrap}>{r.email || dash}</td>
                    <td style={tdNoWrap} className="ed-mono">
                      {formatTel(r.tel)}
                    </td>
                    <td style={tdNoWrap}>{r.inscritLe}</td>
                    <td style={tdNoWrap}>{ymdLabel(r.echeance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {emails.length > 0 && (
            <div className="no-print">
              <div className="ms-grp">Adresses e-mail à copier</div>
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
