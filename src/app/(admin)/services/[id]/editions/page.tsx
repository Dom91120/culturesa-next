import { AdminDemInfo } from "@/components/admin-dem-info";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import { listEditionRows } from "@/server/services/editions";
import { notFound } from "next/navigation";
import { PrintButton } from "./print-button";

// En-tête de colonne du panel « Éditions disponibles » (même style que « Modèles d'e-mails »).
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: ".5rem .6rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
};
const cellStyle: React.CSSProperties = {
  padding: ".55rem .6rem",
  borderBottom: "1px solid var(--border)",
};

export default async function EditionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const rows = await listEditionRows(id);
  const demRows = await getServiceDemandeurSettingsLabeled(id);

  // Éditions proposées pour ce service. Une ligne par édition (façon « Modèles d'e-mails »).
  // L'export CSV télécharge un fichier (Content-Disposition) ; les autres ouvrent une page.
  const editions: {
    icon: string;
    label: string;
    description: string;
    href: string;
    action: string;
  }[] = [
    {
      icon: "📥",
      label: "Export CSV",
      description:
        "Toutes les réservations du service au format CSV (compatible Excel, UTF-8, séparateur point-virgule).",
      href: `/services/${id}/editions/export`,
      action: "Télécharger",
    },
    {
      icon: "🗓",
      label: "Planning hebdomadaire",
      description:
        "Vue par jour des séances d'une semaine (récurrentes + ponctuelles), avec les participants.",
      href: `/services/${id}/editions/planning`,
      action: "Ouvrir",
    },
    {
      icon: "✔",
      label: "Pointages",
      description: "Feuille de présence par séance, à imprimer pour relever les présences.",
      href: `/services/${id}/editions/pointages`,
      action: "Ouvrir",
    },
  ];

  return (
    <div>
      <div className="panel-title" style={{ marginBottom: "1rem" }}>
        <span className="dot" />
        Éditions — {service.label}
      </div>

      {/* Panel « Éditions disponibles » (première position, façon « Modèles d'e-mails »). */}
      <div className="panel no-print" id="editions-panel">
        <div className="panel-title">
          <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            <span className="dot" style={{ background: "var(--accent)" }} />
            Éditions disponibles
          </span>
        </div>

        <p
          style={{ fontSize: ".85rem", lineHeight: 1.5, color: "var(--muted)", margin: "0 0 1rem" }}
        >
          Documents et exports proposés pour ce service. Une ligne par édition : cliquez pour la
          générer, l'ouvrir ou l'imprimer.
        </p>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
          <thead>
            <tr>
              <th style={thStyle}>Édition</th>
              <th style={{ ...thStyle, textAlign: "center", width: 160 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {editions.map((e) => (
              <tr key={e.href}>
                <td style={cellStyle}>
                  <div style={{ fontWeight: 600 }}>
                    <span aria-hidden="true" style={{ marginRight: ".4rem" }}>
                      {e.icon}
                    </span>
                    {e.label}
                  </div>
                  <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
                    {e.description}
                  </div>
                </td>
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  <a
                    href={e.href}
                    className="btn btn-ghost"
                    style={{ fontSize: ".78rem", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    {e.action}
                  </a>
                </td>
              </tr>
            ))}
            {/* Impression de la liste ci-dessous (action client, pas une page). */}
            <tr>
              <td style={cellStyle}>
                <div style={{ fontWeight: 600 }}>
                  <span aria-hidden="true" style={{ marginRight: ".4rem" }}>
                    🖨
                  </span>
                  Imprimer la liste
                </div>
                <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
                  Impression de la liste des réservations affichée ci-dessous.
                </div>
              </td>
              <td style={{ ...cellStyle, textAlign: "center" }}>
                <PrintButton label="🖨 Imprimer" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
            {rows.map((r) => (
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
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}
                >
                  Aucune réservation pour ce service.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: ".75rem" }}>
        {rows.length} réservation{rows.length > 1 ? "s" : ""}. Le CSV est compatible Excel (UTF-8,
        séparateur point-virgule).
      </p>

      <AdminDemInfo rows={demRows} />
    </div>
  );
}
