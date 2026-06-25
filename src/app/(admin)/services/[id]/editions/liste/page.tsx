import { AdminDemInfo } from "@/components/admin-dem-info";
import { prisma } from "@/server/db";
import { getServiceDemandeurSettingsLabeled } from "@/server/services/demandeur-settings";
import { listEditionRows } from "@/server/services/editions";
import { notFound } from "next/navigation";
import { PrintButton } from "../print-button";

// Édition « Liste des réservations » : tableau complet des réservations du service, sur son
// propre écran (comme Planning / Pointages), avec impression. Ouvert depuis le catalogue
// d'éditions (cf. ../page.tsx).
export default async function EditionsListePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const rows = await listEditionRows(id);
  const demRows = await getServiceDemandeurSettingsLabeled(id);

  const linkBtn: React.CSSProperties = {
    fontSize: ".78rem",
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
  };

  return (
    <div>
      <div
        className="no-print"
        style={{
          display: "flex",
          gap: ".5rem",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <a href={`/services/${id}/editions`} style={linkBtn}>
          ← Éditions
        </a>
        <PrintButton label="🖨 Imprimer la liste" />
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem" }}>
        Liste des réservations — {service.label}
      </h2>

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
