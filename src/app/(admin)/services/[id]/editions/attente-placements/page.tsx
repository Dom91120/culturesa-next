import { notFound } from "next/navigation";
import { TargetGlyph } from "@/components/ui-glyphs";
import { prisma } from "@/server/db";
import { listWaitingPlacements } from "@/server/services/waiting-list-editions";
import { muted, tdNoWrap, WaitlistEditionHeader } from "../attente/header";
import { dash, EditionSummary, WhoLabel } from "../edition-header";
import { resolveEditionExercice } from "../range";

export const metadata = { title: "CultuRésa — Placements depuis la liste d'attente" };

// Édition « Placements » : les inscriptions de l'exercice (date d'inscription) qui ont
// abouti à une réservation — automatique ou obtenue — avec le délai et le créneau.
export default async function EditionsAttentePlacementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ exercice?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [service, exo] = await Promise.all([
    prisma.service.findUnique({ where: { id }, select: { label: true } }),
    resolveEditionExercice(id, sp.exercice),
  ]);
  if (!service) notFound();
  const { exercices, selected } = exo;
  const rows = await listWaitingPlacements(
    id,
    selected ? { from: selected.dateStart, to: selected.dateEnd } : undefined,
  );
  const q = selected ? `&exercice=${selected.id}` : "";
  const avg =
    rows.length > 0
      ? Math.round((rows.reduce((s, r) => s + r.delaiJours, 0) / rows.length) * 10) / 10
      : null;
  const auto = rows.filter((r) => r.issue === "AUTO_BOOKED").length;

  return (
    <div className="panel ed-screen">
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Placements depuis la liste d'attente"
        icon={<TargetGlyph size={16} />}
        tone="ok"
        exercices={exercices}
        selectedId={selected?.id ?? null}
        csvHref={`/services/${id}/editions/export?kind=attente-placements${q}`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente-placements${q}`}
      />
      {rows.length === 0 ? (
        <p className="ed-empty">Aucun placement depuis la liste d'attente sur cet exercice.</p>
      ) : (
        <>
          <EditionSummary
            pills={[
              { text: `${rows.length} placement${rows.length > 1 ? "s" : ""}`, tone: "ok" },
              ...(auto > 0 ? [{ text: `${auto} automatique${auto > 1 ? "s" : ""}` }] : []),
              ...(avg != null ? [{ text: `délai moyen ${avg} j` }] : []),
            ]}
          />
          <div className="ed-table-wrap">
            <table className="ed-table" style={{ tableLayout: "fixed", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Usager</th>
                  <th style={{ width: "16%" }}>Structure</th>
                  <th style={{ width: 96 }}>Inscrit le</th>
                  <th style={{ width: 96 }}>Placé le</th>
                  <th style={{ width: 54, textAlign: "right" }}>Délai</th>
                  <th style={{ width: 96 }}>Mode</th>
                  <th>Réservation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={tdNoWrap}>
                      <WhoLabel label={r.usager} email={r.email} sub={r.email || undefined} />
                    </td>
                    <td style={tdNoWrap}>{r.structure || dash}</td>
                    <td style={tdNoWrap}>{r.inscritLe}</td>
                    <td style={tdNoWrap}>{r.clotureLe}</td>
                    <td style={{ textAlign: "right" }}>{r.delaiJours} j</td>
                    <td style={tdNoWrap}>
                      <span className={`ms-pill ${r.mode === "Automatique" ? "is-ok" : "is-info"}`}>
                        {r.mode}
                      </span>
                    </td>
                    <td>
                      {r.reservation || "—"}
                      {r.suppression && (
                        <div style={{ ...muted, color: "var(--danger)" }}>{r.suppression}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
