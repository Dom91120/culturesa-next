import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { listEditionRows } from "@/server/services/editions";

export default async function EditionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const rows = await listEditionRows(id);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: ".75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div className="panel-title" style={{ marginBottom: 0 }}>
          <span className="dot" />
          Éditions — {service.label}
        </div>
        <a
          href={`/services/${id}/editions/export`}
          className="btn btn-primary"
          style={{ textDecoration: "none" }}
        >
          📥 Export CSV
        </a>
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
                    className={`role-pill ${r.statut === "Validée" ? "role-utilisateur" : "role-gestionnaire"}`}
                  >
                    {r.statut}
                  </span>
                </td>
                <td>{r.pointage || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
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
    </div>
  );
}
