import type { ReactNode } from "react";
import { HourglassGlyph } from "@/components/ui-glyphs";
import { EditionHeader, type EditionTone } from "../edition-header";

// En-tête commun des éditions de la LISTE D'ATTENTE (Dom 2026-09-07, refonte 2026-09-09) :
// même barre que les autres éditions (EditionHeader), pictogramme sablier par défaut,
// navigation d'exercice pour les éditions d'historique seulement.
export function WaitlistEditionHeader({
  serviceId,
  serviceLabel,
  title,
  icon,
  tone = "warn",
  exercices,
  selectedId,
  csvHref,
  pdfHref,
}: {
  serviceId: string;
  serviceLabel: string;
  title: string;
  icon?: ReactNode;
  tone?: EditionTone;
  exercices?: { id: number; label: string }[];
  selectedId?: number | null;
  csvHref?: string;
  pdfHref: string;
}) {
  return (
    <EditionHeader
      serviceId={serviceId}
      serviceLabel={serviceLabel}
      title={title}
      icon={icon ?? <HourglassGlyph size={16} />}
      tone={tone}
      exercices={exercices}
      selectedId={selectedId}
      csvHref={csvHref}
      pdfHref={pdfHref}
    />
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
