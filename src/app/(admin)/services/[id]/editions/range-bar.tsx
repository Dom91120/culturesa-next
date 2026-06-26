import { PrintButton } from "./print-button";
import type { RangeResult } from "./range";
import { RangeSelect } from "./range-select";
import { RupturesToggle } from "./ruptures-toggle";

// Barre de contrôle partagée (Plannings / Pointages) : « ← Éditions » à gauche, le bloc
// « ◀ <plage> ▶ » centré en absolu sur toute la largeur (.app-main) — flèches sans texte,
// plage imprimée — et le segmented control + impression à droite (façon agenda).
export function RangeBar({
  serviceId,
  screen,
  range,
  extra,
  ruptures = false,
}: {
  serviceId: string;
  screen: string;
  range: RangeResult;
  // Contrôle additionnel placé à gauche du segmented control (ex. tri de la Liste).
  extra?: React.ReactNode;
  // État de la case « avec ruptures » — propagé aux navigations pour le conserver.
  ruptures?: boolean;
}) {
  const { mode, dateParam, periodId, longPeriods, subtitle, prevHref, nextHref } = range;
  const rq = ruptures ? "&ruptures=1" : "";
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
    <div style={{ marginBottom: "1rem" }}>
      {/* Ligne 1 : ← Éditions (gauche) · plage ◀…▶ centrée (absolu, .app-main) · tri à droite. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          minHeight: "2rem",
        }}
      >
        <a
          href={`/services/${serviceId}/editions`}
          className="no-print"
          style={{
            ...linkBtn,
            fontSize: ".7rem",
            padding: "3px 8px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ← Éditions
        </a>

        {/* Sélecteur de tri (Alphabétique|Par date) : toujours ligne 1, à droite. */}
        {extra && (
          <div className="no-print" style={{ marginLeft: "auto", display: "flex" }}>
            {extra}
          </div>
        )}

        {/* Plage ◀ <plage> ▶ : centrée en absolu sur .app-main ; reste imprimée. */}
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
              href={`${prevHref}${rq}`}
              className="no-print"
              style={arrowBtn}
              title={prevLabel}
              aria-label={prevLabel}
            >
              ◀
            </a>
          )}
          <span
            style={{
              fontSize: ".72rem",
              fontWeight: 600,
              letterSpacing: "-.02em",
              color: "var(--muted)",
            }}
          >
            {subtitle}
          </span>
          {nextHref && (
            <a
              href={`${nextHref}${rq}`}
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

      {/* Ligne 2 : sélecteur de vue (Hebdo|Mensuel|Année) à GAUCHE ; checkbox « avec ruptures »
          + impression à DROITE. */}
      <div
        className="no-print"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: ".6rem",
        }}
      >
        <RangeSelect
          serviceId={serviceId}
          screen={screen}
          mode={mode}
          date={dateParam}
          periodId={periodId}
          periods={longPeriods}
          ruptures={ruptures}
        />
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginLeft: "auto" }}>
          <RupturesToggle />
          <PrintButton iconOnly />
        </div>
      </div>
    </div>
  );
}
