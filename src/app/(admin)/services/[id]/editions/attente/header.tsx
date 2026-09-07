import { ExerciceNav } from "../exercice-nav";
import { ExportButton } from "../export-button";
import { PrintButton } from "../print-button";

// En-tête commun des éditions de la LISTE D'ATTENTE (Dom 2026-09-07) : même squelette
// que la liste des inscrits — retour « ← Éditions », titre centré (navigation d'exercice
// pour les éditions d'historique), export CSV et impression PDF à droite.

const linkBtn: React.CSSProperties = {
  fontSize: ".7rem",
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface1)",
  color: "var(--text)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export function WaitlistEditionHeader({
  serviceId,
  serviceLabel,
  title,
  exercices,
  selectedId,
  csvHref,
  pdfHref,
}: {
  serviceId: string;
  serviceLabel: string;
  title: string;
  exercices?: { id: number; label: string }[];
  selectedId?: number | null;
  csvHref?: string;
  pdfHref: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        minHeight: "2rem",
        marginBottom: "1rem",
      }}
    >
      <a href={`/services/${serviceId}/editions`} className="no-print" style={linkBtn}>
        ← Éditions
      </a>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          display: "inline-flex",
          alignItems: "center",
          gap: ".5rem",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {title}
        {exercices && <ExerciceNav exercices={exercices} selectedId={selectedId ?? null} />}
        <span className="print-only">- {serviceLabel}</span>
      </div>
      <div
        className="no-print"
        style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".6rem" }}
      >
        {csvHref && <ExportButton href={csvHref} />}
        <PrintButton iconOnly href={pdfHref} title="Imprimer (PDF)" />
      </div>
    </div>
  );
}

/** Date AAAA-MM-JJ → « 30/06/2027 » (sans décalage de fuseau). */
export function ymdLabel(ymd: string | null): string {
  return ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString("fr-FR") : "—";
}

/** Horodatage ISO → « 07/09/2026 ». */
export function isoDateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
}

export const tdNoWrap: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export const muted: React.CSSProperties = { fontSize: ".72rem", color: "var(--muted)" };
