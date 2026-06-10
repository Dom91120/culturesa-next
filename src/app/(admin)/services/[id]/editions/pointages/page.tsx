import { prisma } from "@/server/db";
import { listDatedSessions } from "@/server/services/editions";
import { notFound } from "next/navigation";
import { PrintButton } from "../print-button";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const fmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const POINTAGE_LABEL: Record<string, string> = { present: "Présent", absent: "Absent" };

export default async function PointagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();

  const ref = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00Z`) : new Date();
  const monday = mondayOf(ref);
  const sunday = addDays(monday, 6);
  const sessions = await listDatedSessions(id, ymd(monday), ymd(sunday));

  const prevWeek = ymd(addDays(monday, -7));
  const nextWeek = ymd(addDays(monday, 7));
  const linkBtn: React.CSSProperties = {
    fontSize: ".78rem",
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    borderBottom: "1px solid var(--border)",
    padding: "3px 6px",
    fontSize: ".72rem",
    textTransform: "uppercase",
    letterSpacing: ".04em",
    color: "var(--muted)",
  };
  const td: React.CSSProperties = {
    borderBottom: "1px solid var(--border)",
    padding: "4px 6px",
    fontSize: ".82rem",
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
        <a href={`/services/${id}/editions/pointages?week=${prevWeek}`} style={linkBtn}>
          ◀ Semaine précédente
        </a>
        <a href={`/services/${id}/editions/pointages?week=${nextWeek}`} style={linkBtn}>
          Semaine suivante ▶
        </a>
        <PrintButton />
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: ".2rem" }}>
        Pointages — {service.label}
      </h2>
      <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Semaine du {ymd(monday)} au {ymd(sunday)}
      </p>

      {sessions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>Aucune séance cette semaine.</p>
      ) : (
        sessions.map((s) => (
          <section
            key={`${s.date}-${s.startTime}`}
            style={{ marginBottom: "1.25rem", breakInside: "avoid" }}
          >
            <h3 style={{ fontSize: ".92rem", fontWeight: 700, marginBottom: ".35rem" }}>
              {fmt.format(new Date(`${s.date}T00:00:00Z`))} · {s.startTime.slice(0, 5)}–
              {s.endTime.slice(0, 5)}{" "}
              <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
              </span>
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Nom</th>
                  <th style={th}>Prénom</th>
                  <th style={th}>Structure</th>
                  <th style={{ ...th, textAlign: "center" }}>Pointage</th>
                  <th style={{ ...th, width: 160 }}>Émargement</th>
                </tr>
              </thead>
              <tbody>
                {s.attendees.map((a, i) => (
                  <tr key={`${a.nom}-${a.prenom}-${i}`}>
                    <td style={{ ...td, fontWeight: 600 }}>{a.nom}</td>
                    <td style={td}>{a.prenom}</td>
                    <td style={td}>{a.structure || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {a.pointage ? POINTAGE_LABEL[a.pointage] : "—"}
                    </td>
                    <td style={td} />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
