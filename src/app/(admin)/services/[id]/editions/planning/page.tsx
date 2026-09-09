import { formatTel } from "@/lib/format";
import type { DatedSession } from "@/server/services/editions";
import { formatDateHeading, type SessionBucket } from "../range";
import { EditionScreenView, type EditionSearchParams, loadEditionScreen } from "../screen";

export const metadata = { title: "CultuRésa — Plannings" };

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<EditionSearchParams>;
}) {
  const { id } = await params;
  // Prologue commun aux écrans datés (service, exercice, plage, séances, PDF) :
  // cf. editions/screen.tsx — seule la présentation d'un bucket est propre au Planning.
  const data = await loadEditionScreen(id, "planning", await searchParams);

  const renderSection = (daySessions: DatedSession[]) => {
    const first = daySessions[0];
    return (
      <section key={first.date} style={{ marginBottom: "1.25rem", breakInside: "avoid" }}>
        <h3 className="ed-h3">{formatDateHeading(first.date)}</h3>
        {daySessions.map((s) => {
          // Comptes anonymisés (RGPD, plus ni nom ni contact) : rien à afficher sur un
          // planning, ni carte ni décompte (Dom 2026-09-09).
          const visibles = s.attendees.filter((a) => `${a.nom}${a.prenom}`.trim() !== "");
          return (
            <div key={`${s.startTime}-${s.endTime}`} style={{ marginBottom: ".6rem" }}>
              <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".15rem" }}>
                {s.startTime && s.endTime
                  ? `${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`
                  : "Journée entière"}{" "}
                <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                  ({visibles.length} inscrit{visibles.length > 1 ? "s" : ""})
                </span>
              </div>
              {/* Cartes participants : côte à côte (flex-wrap) — elles passent à la ligne
                seulement quand la largeur ne suffit plus. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
                {visibles.map((a, i) => (
                  <div key={`${a.nom}-${a.prenom}-${i}`} className="ed-att">
                    {/* Cinq lignes tronquées (points de suspension, texte complet en infobulle),
                      sans réserve de hauteur : les cartes se resserrent sur leur contenu
                      (Dom 2026-09-09). Compte anonymisé : pas d'adresse technique. */}
                    <div className="ed-att-line" style={{ fontWeight: 600 }}>
                      {`${a.nom} ${a.prenom}`.trim() || "—"}
                    </div>
                    <div className="ed-att-line" title={a.structure || a.demandeur || undefined}>
                      {a.structure || a.demandeur || "—"}
                    </div>
                    <div className="ed-att-line ed-mu">Tel : {formatTel(a.tel)}</div>
                    <div className="ed-att-line ed-mu" title={a.email || undefined}>
                      {a.email || "—"}
                    </div>
                    <div className="ed-att-line ed-mu" title={a.theme || undefined}>
                      {a.theme || "—"}
                    </div>
                    <div className="ed-att-foot">
                      <span>
                        {a.enfants} enfant{a.enfants > 1 ? "s" : ""}
                      </span>
                      <span>
                        {a.accompagnants} adulte{a.accompagnants > 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    );
  };

  // Planning : regroupe les séances du bucket PAR DATE (une section par jour).
  const renderBucket = (b: SessionBucket) => {
    const byDate = new Map<string, DatedSession[]>();
    for (const s of b.sessions) {
      const arr = byDate.get(s.date);
      if (arr) arr.push(s);
      else byDate.set(s.date, [s]);
    }
    return [...byDate.values()].map(renderSection);
  };

  return (
    <EditionScreenView serviceId={id} screen="planning" data={data} renderBucket={renderBucket} />
  );
}
