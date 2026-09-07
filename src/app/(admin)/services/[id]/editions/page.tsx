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
  const service = await prisma.service.findUnique({
    where: { id },
    select: { label: true, listeAttente: true },
  });
  if (!service) notFound();
  // Éditions de la liste d'attente : proposées si le réglage est actif, ou s'il reste un
  // historique à consulter (liste désactivée depuis).
  const withWaitlist =
    service.listeAttente || (await prisma.waitingListLog.count({ where: { serviceId: id } })) > 0;

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

  // Éditions de la liste d'attente (Dom 2026-09-07) : trois « état du jour » (liste en
  // cours, demande par demi-journée, adresses) et deux « historique » par exercice
  // (historique, placements) — à lire en fin de période / d'exercice.
  const waitlistEditions: typeof editions = [
    {
      icon: "⏳",
      label: "Liste d'attente en cours",
      description:
        "Les inscrits du jour dans l'ordre d'inscription : disponibilités, périodes souhaitées, réservation automatique, dates et échéance.",
      href: `/services/${id}/editions/attente`,
      action: "Ouvrir",
    },
    {
      icon: "📊",
      label: "Demande par demi-journée",
      description:
        "Combien d'inscrits se sont déclarés disponibles chaque demi-journée et sur chaque période : où ouvrir un créneau ferait le plus d'heureux.",
      href: `/services/${id}/editions/attente-demande`,
      action: "Ouvrir",
    },
    {
      icon: "📜",
      label: "Historique de la liste d'attente",
      description:
        "Toutes les inscriptions closes de l'exercice : issue (placé, périodes échues, retrait), délai et réservation obtenue — à lire en fin de période ou d'exercice.",
      href: `/services/${id}/editions/attente-historique`,
      action: "Ouvrir",
    },
    {
      icon: "🎯",
      label: "Placements depuis la liste d'attente",
      description:
        "Les inscriptions de l'exercice qui ont abouti à une réservation (automatique ou obtenue), avec le délai et le créneau.",
      href: `/services/${id}/editions/attente-placements`,
      action: "Ouvrir",
    },
    {
      icon: "✉️",
      label: "Adresses des inscrits",
      description:
        "Coordonnées des inscrits du jour, avec les adresses e-mail prêtes à coller pour un envoi groupé.",
      href: `/services/${id}/editions/attente-adresses`,
      action: "Ouvrir",
    },
  ];

  const renderRows = (list: typeof editions) =>
    list.map((e) => (
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
    ));

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
          <tbody>{renderRows(editions)}</tbody>
        </table>
      </div>

      {withWaitlist && (
        <div className="panel" id="editions-attente-panel" style={{ marginTop: "1rem" }}>
          <div className="panel-title">
            <span className="dot" style={{ background: "var(--warn)" }} />
            Liste d'attente
          </div>
          <p
            style={{
              fontSize: ".85rem",
              lineHeight: 1.5,
              color: "var(--muted)",
              margin: "0 0 1rem",
            }}
          >
            Qui attend, quand, et ce qu'il est advenu des inscriptions. Les trois premières
            décrivent l'état du jour ; l'historique et les placements se lisent par exercice.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
            <thead>
              <tr>
                <th style={thStyle}>Édition</th>
                <th style={{ ...thStyle, textAlign: "center", width: 160 }}>Action</th>
              </tr>
            </thead>
            <tbody>{renderRows(waitlistEditions)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
