import { prisma } from "@/server/db";
import { listDatedSessions } from "@/server/services/editions";
import { notFound } from "next/navigation";
import { PrintButton } from "../print-button";

const DAY_ORDER = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = lundi
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const fmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const { week } = await searchParams;
  const ref = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(`${week}T00:00:00Z`) : new Date();
  const monday = mondayOf(ref);
  const sunday = addDays(monday, 6);
  // Libellé du service et sessions datées : indépendants → chargés en parallèle.
  const [service, sessions] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    listDatedSessions(id, ymd(monday), ymd(sunday)),
  ]);
  if (!service) notFound();

  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byDay.get(s.dayKey) ?? [];
    list.push(s);
    byDay.set(s.dayKey, list);
  }

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
        <a href={`/services/${id}/editions/planning?week=${prevWeek}`} style={linkBtn}>
          ◀ Semaine précédente
        </a>
        <a href={`/services/${id}/editions/planning?week=${nextWeek}`} style={linkBtn}>
          Semaine suivante ▶
        </a>
        <PrintButton />
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: ".2rem" }}>
        Planning hebdomadaire — {service.label}
      </h2>
      <p style={{ fontSize: ".85rem", color: "var(--muted)", marginBottom: "1rem" }}>
        Semaine du {fmt.format(monday)} au {fmt.format(sunday)}
      </p>

      {sessions.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>Aucune séance cette semaine.</p>
      ) : (
        DAY_ORDER.filter((d) => byDay.has(d)).map((d) => {
          const list = byDay.get(d) ?? [];
          const dayDate = addDays(monday, DAY_ORDER.indexOf(d));
          return (
            <section key={d} style={{ marginBottom: "1.25rem", breakInside: "avoid" }}>
              <h3
                style={{
                  fontSize: ".95rem",
                  fontWeight: 700,
                  borderBottom: "2px solid var(--accent)",
                  paddingBottom: ".2rem",
                  marginBottom: ".5rem",
                }}
              >
                {list[0].dayLabel} {fmt.format(dayDate)}
              </h3>
              {list.map((s) => (
                <div key={`${s.startTime}-${s.endTime}`} style={{ marginBottom: ".6rem" }}>
                  <div style={{ fontWeight: 600, fontSize: ".85rem" }}>
                    {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                      ({s.attendees.length})
                    </span>
                  </div>
                  <ul style={{ margin: ".2rem 0 0 1rem", fontSize: ".82rem", lineHeight: 1.5 }}>
                    {s.attendees.map((a, i) => (
                      <li key={`${a.nom}-${a.prenom}-${i}`}>
                        {a.nom} {a.prenom}
                        {a.structure ? ` — ${a.structure}` : ""}
                        {a.theme ? ` · ${a.theme}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
