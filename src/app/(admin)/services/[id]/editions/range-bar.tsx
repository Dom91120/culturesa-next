import { ExportButton } from "./export-button";
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
  exportHref,
  selectedExerciceId = null,
  showRuptures = true,
  title,
}: {
  serviceId: string;
  screen: string;
  range: RangeResult;
  // Titre centré de la ligne 1 (ex. « Liste des réservations <nav exercice> Service »).
  // La navigation d'exercice ◀ ▶ est intégrée au titre (ExerciceNav) ; la navigation de
  // plage ◀…▶ passe alors au centre de la ligne 2.
  title?: React.ReactNode;
  // Contrôle additionnel placé à gauche du segmented control (ex. tri de la Liste).
  extra?: React.ReactNode;
  // État de la case « avec ruptures » — propagé aux navigations pour le conserver.
  ruptures?: boolean;
  // Lien d'export CSV (Liste) → bouton export à gauche de l'impression. Absent ailleurs.
  exportHref?: string;
  // Exercice courant : propagé aux liens de changement de vue pour le conserver.
  selectedExerciceId?: number | null;
  // Case « avec ruptures » : masquée quand la table est triable par colonne (Liste).
  showRuptures?: boolean;
}) {
  const { mode, dateParam, subtitle, prevHref, nextHref } = range;
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
  const unit = mode === "month" ? "Mois" : mode === "trimester" ? "Trimestre" : "Semaine";
  const prevLabel = `${unit} précédent${unit === "Semaine" ? "e" : ""}`;
  const nextLabel = `${unit} suivant${unit === "Semaine" ? "e" : ""}`;

  // Centrage absolu (au milieu de .app-main), utilisé pour le titre et/ou la plage ◀…▶.
  const centerAbs: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    display: "flex",
    alignItems: "center",
    gap: ".6rem",
    whiteSpace: "nowrap",
  };

  // Plage ◀ <plage> ▶ (reste imprimée). Centrée : ligne 1 par défaut, ligne 2 si un titre
  // occupe déjà le centre de la ligne 1.
  const plageNav = (
    <div style={centerAbs}>
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
          fontSize: ".8rem",
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
  );

  return (
    <div style={{ marginBottom: "1rem" }}>
      {/* Ligne 1 : ← Éditions (gauche) · titre OU plage centré(e) · sélecteur de vue (droite). */}
      <div
        style={{ position: "relative", display: "flex", alignItems: "center", minHeight: "2rem" }}
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

        <div
          className="no-print"
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".6rem" }}
        >
          {extra}
          <RangeSelect
            serviceId={serviceId}
            screen={screen}
            mode={mode}
            date={dateParam}
            ruptures={ruptures}
            exerciceId={selectedExerciceId}
          />
        </div>

        {title ? <div style={centerAbs}>{title}</div> : plageNav}
      </div>

      {/* Ligne 2 : plage ◀…▶ au centre ; « avec ruptures » + export/impression à droite. */}
      <div
        className="no-print"
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: ".6rem",
          minHeight: title ? "2rem" : undefined,
        }}
      >
        {title && plageNav}
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginLeft: "auto" }}>
          {showRuptures && <RupturesToggle />}
          {exportHref && <ExportButton href={exportHref} />}
          <PrintButton iconOnly />
        </div>
      </div>
    </div>
  );
}
