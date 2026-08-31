import { notFound } from "next/navigation";
import { prisma } from "@/server/db";

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

  // Éditions proposées pour ce service. Une ligne par édition (façon « Modèles d'e-mails »).
  // L'export CSV télécharge un fichier (Content-Disposition) ; les autres ouvrent un écran dédié.
  const editions: {
    icon: string;
    label: string;
    description: string;
    href: string;
    action: string;
  }[] = [
    {
      icon: "👥",
      label: "Liste des inscrits",
      description:
        "Les usagers ayant réservé sur l'exercice — identité, structure, niveau et contact.",
      href: `/services/${id}/editions/inscrits`,
      action: "Ouvrir",
    },
    {
      icon: "🕒",
      label: "Liste des créneaux ouverts",
      description:
        "L'offre de réservation du service : les créneaux proposés sur l'exercice, avec horaires, places et demandeurs.",
      href: `/services/${id}/editions/creneaux`,
      action: "Ouvrir",
    },
    {
      icon: "📋",
      label: "Liste des réservations",
      description:
        "Tableau de toutes les réservations du service, à consulter et imprimer sur son écran dédié.",
      href: `/services/${id}/editions/liste`,
      action: "Ouvrir",
    },
    {
      icon: "🗓",
      label: "Plannings",
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
      <div className="panel" id="editions-panel">
        <div className="panel-title">
          <span className="dot" style={{ background: "var(--accent)" }} />
          Éditions disponibles
        </div>

        <p
          style={{ fontSize: ".85rem", lineHeight: 1.5, color: "var(--muted)", margin: "0 0 1rem" }}
        >
          Documents et exports proposés pour ce service. Une ligne par édition : cliquez pour
          l'ouvrir ou la télécharger.
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
