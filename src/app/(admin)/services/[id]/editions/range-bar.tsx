import type { ReactNode } from "react";
import { ArrowLeftGlyph, ArrowRightGlyph } from "@/components/ui-glyphs";
import { EditionHeader, type EditionTone } from "./edition-header";
import type { RangeResult } from "./range";
import { RangeSelect } from "./range-select";
import { RupturesToggle } from "./ruptures-toggle";

// Barre de contrôle partagée des écrans DATÉS (Plannings / Pointages / Liste) — refonte
// Dom 2026-09-09 : EditionHeader (retour, titre, exercice) + navigation de plage
// « ◀ plage ▶ » imprimée, puis à droite les filtres, le sélecteur de vue, CSV et PDF.
export function RangeBar({
  serviceId,
  serviceLabel,
  screen,
  range,
  extra,
  ruptures = false,
  exportHref,
  pdfHref,
  selectedExerciceId = null,
  showRuptures = true,
  title,
  icon,
  tone = "purple",
  exercices,
}: {
  serviceId: string;
  serviceLabel: string;
  screen: string;
  range: RangeResult;
  title: string;
  icon: ReactNode;
  tone?: EditionTone;
  exercices: { id: number; label: string }[];
  // Contrôle additionnel placé à gauche du sélecteur de vue (ex. tri de la Liste).
  extra?: ReactNode;
  // État de la pastille « avec ruptures » — propagé aux navigations pour le conserver.
  ruptures?: boolean;
  // Lien d'export CSV (Liste). Absent ailleurs.
  exportHref?: string;
  // Si fourni, le bouton d'impression ouvre ce PDF serveur (Puppeteer) au lieu de window.print().
  pdfHref?: string;
  selectedExerciceId?: number | null;
  // Pastille « avec ruptures » : masquée quand la table est triable par colonne (Liste).
  showRuptures?: boolean;
}) {
  const { mode, dateParam, subtitle, prevHref, nextHref } = range;
  const rq = ruptures ? "&ruptures=1" : "";
  const unit = mode === "month" ? "Mois" : mode === "trimester" ? "Trimestre" : "Semaine";
  const prevLabel = `${unit} précédent${unit === "Semaine" ? "e" : ""}`;
  const nextLabel = `${unit} suivant${unit === "Semaine" ? "e" : ""}`;

  // Flèche ◀/▶ : lien actif si `href`, sinon variante grisée (au lieu de disparaître).
  const arrow = (href: string | null, glyph: ReactNode, label: string) =>
    href ? (
      <a href={`${href}${rq}`} className="acct-action no-print" title={label} aria-label={label}>
        {glyph}
      </a>
    ) : (
      <span className="acct-action no-print is-off" aria-disabled="true" aria-label={label}>
        {glyph}
      </span>
    );

  // En mode annuel, la plage couvre tout l'exercice : la navigation ◀…▶ n'a pas de sens.
  const plage =
    mode !== "year" ? (
      <span className="edh-range">
        {arrow(prevHref, <ArrowLeftGlyph size={13} />, prevLabel)}
        <span className="edh-range-label">{subtitle}</span>
        {arrow(nextHref, <ArrowRightGlyph size={13} />, nextLabel)}
      </span>
    ) : null;

  return (
    <EditionHeader
      serviceId={serviceId}
      serviceLabel={serviceLabel}
      title={title}
      icon={icon}
      tone={tone}
      exercices={exercices}
      selectedId={selectedExerciceId}
      center={plage}
      right={
        <>
          {extra}
          {showRuptures && <RupturesToggle />}
          <RangeSelect
            serviceId={serviceId}
            screen={screen}
            mode={mode}
            date={dateParam}
            ruptures={ruptures}
            exerciceId={selectedExerciceId}
          />
        </>
      }
      csvHref={exportHref}
      pdfHref={pdfHref}
    />
  );
}
