import { type DatedSession, POINTAGE_LABEL } from "@/server/services/editions";
import { formatDateHeading, type SessionBucket } from "../range";
import { EditionScreenView, type EditionSearchParams, loadEditionScreen } from "../screen";

export const metadata = { title: "CultuRésa — Pointages" };

export default async function PointagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<EditionSearchParams>;
}) {
  const { id } = await params;
  // Prologue commun aux écrans datés (service, exercice, plage, séances, PDF) :
  // cf. editions/screen.tsx — seule la présentation d'un bucket est propre aux Pointages.
  const data = await loadEditionScreen(id, "pointages", await searchParams);

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

  const renderSession = (s: DatedSession) => (
    <section
      key={`${s.date}-${s.startTime}`}
      style={{ marginBottom: "1.25rem", breakInside: "avoid" }}
    >
      <h3 style={{ fontSize: ".9rem", fontWeight: 700, marginBottom: ".35rem" }}>
        {formatDateHeading(s.date)} ·{" "}
        {s.startTime && s.endTime
          ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
          : "Journée entière"}{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
          ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
        </span>
      </h3>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "28%" }}>Identité</th>
            <th style={th}>Structure</th>
            <th style={th}>Thème</th>
            <th style={{ ...th, width: 150 }}>Participants</th>
            <th style={{ ...th, textAlign: "center", width: 110 }}>Pointage</th>
            <th style={{ ...th, width: 120 }}>Émargement</th>
          </tr>
        </thead>
        <tbody>
          {s.attendees.map((a, i) => (
            <tr key={`${a.nom}-${a.prenom}-${i}`}>
              <td style={{ ...td, fontWeight: 600 }}>{`${a.nom} ${a.prenom}`.trim() || "—"}</td>
              <td style={td}>{a.structure || a.demandeur || "—"}</td>
              <td style={td}>{a.theme || "—"}</td>
              <td style={td}>
                {a.enfants} enfant{a.enfants > 1 ? "s" : ""} + {a.accompagnants} adulte
                {a.accompagnants > 1 ? "s" : ""}
              </td>
              <td style={{ ...td, textAlign: "center" }}>
                {a.pointage ? POINTAGE_LABEL[a.pointage] : "—"}
                {/* Motif d'absence saisi dans la fiche : sous l'état, en discret. */}
                {a.pointage === "absent" && a.pointageMotif.trim() !== "" && (
                  <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>{a.pointageMotif}</div>
                )}
              </td>
              <td style={td} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  const renderBucket = (b: SessionBucket) => b.sessions.map(renderSession);

  return (
    <EditionScreenView serviceId={id} screen="pointages" data={data} renderBucket={renderBucket} />
  );
}
