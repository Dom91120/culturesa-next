import { PrintButton } from "./print-button";
import type { RangeResult } from "./range";
import { RangeSelect } from "./range-select";

// Barre de contrôle partagée (Plannings / Pointages) : « ← Éditions » à gauche, le bloc
// « ◀ <plage> ▶ » centré en absolu sur toute la largeur (.app-main) — flèches sans texte,
// plage imprimée — et le segmented control + impression à droite (façon agenda).
export function RangeBar({
  serviceId,
  screen,
  range,
  extra,
}: {
  serviceId: string;
  screen: string;
  range: RangeResult;
  // Contrôle additionnel placé à gauche du segmented control (ex. tri de la Liste).
  extra?: React.ReactNode;
}) {
  const { mode, dateParam, periodId, longPeriods, subtitle, prevHref, nextHref } = range;
  const linkBtn: React.CSSProperties = {
    fontSize: ".78rem",
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    textDecoration: "none",
  };
  // Flèches de navigation : plus petites que les autres boutons.
  const arrowBtn: React.CSSProperties = { ...linkBtn, fontSize: ".62rem", padding: "2px 6px" };
  const prevLabel = mode === "month" ? "Mois précédent" : "Semaine précédente";
  const nextLabel = mode === "month" ? "Mois suivant" : "Semaine suivante";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        gap: ".5rem",
        alignItems: "center",
        minHeight: "2rem",
        marginBottom: "1rem",
      }}
    >
      <a
        href={`/services/${serviceId}/editions`}
        className="no-print"
        style={{ ...linkBtn, fontSize: ".7rem", padding: "3px 8px" }}
      >
        ← Éditions
      </a>

      <div className="agenda-mode-toggles-wrap no-print" style={{ marginLeft: "auto" }}>
        {extra}
        <RangeSelect
          serviceId={serviceId}
          screen={screen}
          mode={mode}
          date={dateParam}
          periodId={periodId}
          periods={longPeriods}
        />
        <PrintButton iconOnly />
      </div>

      {/* Centre (absolu) : ◀ <plage> ▶ — la plage reste imprimée. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          alignItems: "center",
          gap: ".6rem",
          whiteSpace: "nowrap",
        }}
      >
        {prevHref && (
          <a
            href={prevHref}
            className="no-print"
            style={arrowBtn}
            title={prevLabel}
            aria-label={prevLabel}
          >
            ◀
          </a>
        )}
        <span style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--muted)" }}>
          {subtitle}
        </span>
        {nextHref && (
          <a
            href={nextHref}
            className="no-print"
            style={arrowBtn}
            title={nextLabel}
            aria-label={nextLabel}
          >
            ▶
          </a>
        )}
      </div>
    </div>
  );
}
