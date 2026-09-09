import { type DatedSession, pointageCell } from "@/server/services/editions";
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

  const renderSession = (s: DatedSession) => (
    <section
      key={`${s.date}-${s.startTime}`}
      style={{ marginBottom: "1.25rem", breakInside: "avoid" }}
    >
      <h3 className="ed-h3">
        {formatDateHeading(s.date)} ·{" "}
        {s.startTime && s.endTime
          ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
          : "Journée entière"}{" "}
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
          ({s.attendees.length} inscrit{s.attendees.length > 1 ? "s" : ""})
        </span>
      </h3>
      <table className="ed-table" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: "28%" }}>Identité</th>
            <th>Structure</th>
            <th>Thème</th>
            <th style={{ width: 150 }}>Participants</th>
            <th style={{ textAlign: "center", width: 110 }}>Pointage</th>
            <th style={{ width: 120 }}>Émargement</th>
          </tr>
        </thead>
        <tbody>
          {s.attendees.map((a, i) => (
            <tr key={`${a.nom}-${a.prenom}-${i}`}>
              <td style={{ fontWeight: 600 }}>{`${a.nom} ${a.prenom}`.trim() || "—"}</td>
              <td>{a.structure || a.demandeur || "—"}</td>
              <td>{a.theme || "—"}</td>
              <td>
                {a.enfants} enfant{a.enfants > 1 ? "s" : ""} + {a.accompagnants} adulte
                {a.accompagnants > 1 ? "s" : ""}
              </td>
              <td style={{ textAlign: "center" }}>
                {/* État relevé, ou « Absence prévenue » si signalée à l'avance et pas
                    encore pointée (« Absent (prévenu) » une fois constatée). */}
                {pointageCell(a.pointage, a.absencePrevenue) || "—"}
                {/* Motif d'absence (fiche ou signalement) : sous l'état, en discret. */}
                {(a.pointage === "absent" || (!a.pointage && a.absencePrevenue)) &&
                  a.pointageMotif.trim() !== "" && (
                    <div style={{ fontSize: ".7rem", color: "var(--muted)" }}>
                      {a.pointageMotif}
                    </div>
                  )}
              </td>
              <td className="ed-sign" />
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
