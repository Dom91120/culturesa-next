import Link from "next/link";
import { listServices } from "@/server/services/services";
import { CreateServiceForm } from "./create-form";

export default async function ServicesPage() {
  const services = await listServices();

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
          Configuration des services
        </div>
        <CreateServiceForm />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="col-check" />
              <th>Service</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td className="col-check">
                  <input type="checkbox" />
                </td>
                <td>
                  <span style={{ marginRight: ".5rem" }}>{s.icon || "📄"}</span>
                  {s.label}{" "}
                  <span style={{ color: "var(--muted)", fontSize: ".7rem" }}>
                    {s._count.slots} créneaux · {s._count.bookings} résa.
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link
                    href={`/services/${s.id}`}
                    className="btn btn-ghost"
                    style={{ textDecoration: "none", padding: ".2rem .7rem", fontSize: ".72rem" }}
                  >
                    Gérer
                  </Link>
                </td>
              </tr>
            ))}
            {services.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: "1.5rem", color: "var(--muted)" }}>
                  Aucun service.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
