import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { waitingDemand } from "@/server/services/waiting-list-editions";
import { WaitlistEditionHeader } from "../attente/header";

export const metadata = { title: "CultuRésa — Demande par demi-journée" };

// Édition « Demande par demi-journée » : combien d'inscrits de la liste d'attente sont
// disponibles chaque demi-journée (et combien ont demandé la réservation automatique),
// puis par période souhaitée — pour décider où ouvrir un créneau. État du jour.
export default async function EditionsAttenteDemandePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { label: true } });
  if (!service) notFound();
  const d = await waitingDemand(id);
  const max = Math.max(1, ...d.byHalfDay.flatMap((r) => [r.am.total, r.pm.total]));

  const cell = (v: { total: number; auto: number }) => (
    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: ".35rem",
          padding: ".15rem .55rem",
          borderRadius: 6,
          // Intensité proportionnelle à la demande (fond vert), 0 = neutre.
          background:
            v.total > 0 ? `rgba(46, 125, 50, ${0.12 + 0.5 * (v.total / max)})` : "transparent",
          color: v.total / max > 0.6 ? "#fff" : "inherit",
          minWidth: 44,
          justifyContent: "center",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "1rem" }}>{v.total}</span>
        {v.auto > 0 && <span style={{ fontSize: ".7rem" }}>({v.auto} auto)</span>}
      </div>
    </td>
  );

  return (
    <div>
      <WaitlistEditionHeader
        serviceId={id}
        serviceLabel={service.label}
        title="Demande par demi-journée"
        csvHref={`/services/${id}/editions/export?kind=attente-demande`}
        pdfHref={`/services/${id}/editions/pdf?kind=attente-demande`}
      />
      {d.inscrits === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--muted)" }}>
          Aucun inscrit sur la liste d'attente.
        </p>
      ) : (
        <>
          <p style={{ fontSize: ".85rem", color: "var(--muted)", margin: "0 0 .8rem" }}>
            Nombre d'inscrits disponibles par demi-journée (un inscrit compte sur chacune des
            demi-journées qu'il a déclarées) ; entre parenthèses, ceux qui ont demandé la
            réservation automatique. Plus la case est foncée, plus l'ouverture d'un créneau
            satisferait d'inscrits.
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table" style={{ tableLayout: "fixed", maxWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Jour</th>
                  <th style={{ textAlign: "center" }}>Matin</th>
                  <th style={{ textAlign: "center" }}>Après-midi</th>
                </tr>
              </thead>
              <tbody>
                {d.byHalfDay.map((r) => (
                  <tr key={r.day}>
                    <td style={{ fontWeight: 600 }}>{r.label}</td>
                    {cell(r.am)}
                    {cell(r.pm)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.byPeriod.length > 1 && (
            <>
              <div className="panel-title" style={{ margin: "1.2rem 0 .5rem" }}>
                <span className="dot" />
                Par période souhaitée
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table" style={{ tableLayout: "fixed", maxWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ width: "40%" }}>Période</th>
                      <th style={{ textAlign: "center" }}>Inscrits</th>
                      <th style={{ textAlign: "center" }}>dont automatique</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byPeriod.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>{p.label}</td>
                        <td style={{ textAlign: "center", fontWeight: 700 }}>{p.total}</td>
                        <td style={{ textAlign: "center" }}>{p.auto || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p style={{ fontSize: ".8rem", fontWeight: 600, margin: ".8rem 0 0" }}>
            {d.inscrits} inscrit{d.inscrits > 1 ? "s" : ""} sur la liste d'attente
            {d.auto > 0 ? ` — dont ${d.auto} en réservation automatique` : ""}
          </p>
        </>
      )}
    </div>
  );
}
