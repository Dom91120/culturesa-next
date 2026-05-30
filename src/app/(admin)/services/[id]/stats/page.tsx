import { notFound } from "next/navigation";
import { prisma } from "@/server/db";

const DAY_ORDER = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const DAY_NAMES: Record<string, string> = {
  lun: "Lundi",
  mar: "Mardi",
  mer: "Mercredi",
  jeu: "Jeudi",
  ven: "Vendredi",
  sam: "Samedi",
  dim: "Dimanche",
};

function StatCard({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 130,
        background: "var(--surface1)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1rem 1.1rem",
      }}
    >
      <div style={{ fontSize: "1.7rem", fontWeight: 700, color: color ?? "var(--text)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: ".72rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", marginTop: ".25rem" }}>
        {label}
      </div>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: ".5rem" }}>
      <div style={{ width: 110, fontSize: ".75rem", color: "var(--muted)", flexShrink: 0, textAlign: "right" }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 16, background: "rgba(127,127,127,.12)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} />
      </div>
      <div style={{ width: 36, fontSize: ".75rem", fontWeight: 600, textAlign: "left", flexShrink: 0 }}>{value}</div>
    </div>
  );
}

export default async function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const bookings = await prisma.booking.findMany({
    where: { serviceId: id },
    select: {
      dayKey: true,
      enfants: true,
      validated: true,
      user: { select: { demandeur: { select: { label: true } } } },
    },
  });

  const total = bookings.length;
  const enfantsTotal = bookings.reduce((s, b) => s + b.enfants, 0);
  const validated = bookings.filter((b) => b.validated).length;
  const pending = total - validated;

  const byDay = new Map<string, number>();
  for (const b of bookings) {
    if (!b.dayKey) continue;
    byDay.set(b.dayKey, (byDay.get(b.dayKey) ?? 0) + 1);
  }
  const dayRows = DAY_ORDER.filter((d) => byDay.has(d)).map((d) => ({ label: DAY_NAMES[d], value: byDay.get(d) ?? 0 }));
  const dayMax = Math.max(1, ...dayRows.map((r) => r.value));

  const byDem = new Map<string, number>();
  for (const b of bookings) {
    const label = b.user.demandeur?.label ?? "(sans demandeur)";
    byDem.set(label, (byDem.get(label) ?? 0) + b.enfants);
  }
  const demRows = [...byDem.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const demMax = Math.max(1, ...demRows.map((r) => r.value));

  return (
    <div>
      <div className="panel-title">
        <span className="dot" />
        Statistiques — {service.label}
      </div>

      <div style={{ display: "flex", gap: ".75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <StatCard value={total} label="Réservations" />
        <StatCard value={enfantsTotal} label="Enfants inscrits" />
        <StatCard value={validated} label="Validées" color="var(--accent)" />
        <StatCard value={pending} label="En attente" color="var(--warn)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: ".85rem" }}>
        <div className="panel">
          <div className="panel-title" style={{ fontSize: ".82rem" }}>
            <span className="dot" />
            Réservations par jour
          </div>
          {dayRows.length === 0 ? (
            <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>Aucune réservation récurrente.</p>
          ) : (
            dayRows.map((r) => <BarRow key={r.label} label={r.label} value={r.value} max={dayMax} />)
          )}
        </div>

        <div className="panel">
          <div className="panel-title" style={{ fontSize: ".82rem" }}>
            <span className="dot" />
            Enfants par demandeur
          </div>
          {demRows.length === 0 ? (
            <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>Aucune donnée.</p>
          ) : (
            demRows.map((r) => <BarRow key={r.label} label={r.label} value={r.value} max={demMax} />)
          )}
        </div>
      </div>
    </div>
  );
}
