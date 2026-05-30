import Link from "next/link";
import { listBookableServices } from "@/server/services/bookings";

export default async function ReserverPage() {
  const services = await listBookableServices();

  return (
    <div>
      <div className="panel-title">
        <span className="dot" />
        Réserver une activité
      </div>

      {services.length === 0 && (
        <div className="panel">
          <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
            Aucune activité disponible pour le moment.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: ".85rem" }}>
        {services.map((s) => (
          <Link key={s.id} href={`/reserver/${s.id}`} className="panel" style={{ textDecoration: "none", display: "block", marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{s.label}</span>
              {s.icon && <span style={{ fontSize: "1.2rem" }}>{s.icon}</span>}
            </div>
            <p style={{ fontSize: ".78rem", color: "var(--muted)", marginTop: ".4rem" }}>
              {s._count.slots > 0
                ? `${s._count.slots} créneau${s._count.slots > 1 ? "x" : ""} à venir`
                : "Aucun créneau à venir"}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
