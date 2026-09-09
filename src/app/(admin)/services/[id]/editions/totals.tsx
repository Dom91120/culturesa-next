import type { Totals } from "./range";

const plural = (n: number) => (n > 1 ? "s" : "");

// En-tête de rupture (semaine / mois / période / demandeur) dans une édition — refonte
// Dom 2026-09-09 : intertitre à filet (même dessin que les groupes des autres écrans).
export function RuptureHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="ed-rupture">{children}</h3>;
}

// Ligne de total / sous-total : libellé puis compteurs en pastilles. `strong` = total général.
export function TotalsBar({
  label,
  parts,
  strong = false,
}: {
  label: string;
  parts: string[];
  strong?: boolean;
}) {
  return (
    <div className={`ed-totals${strong ? " is-strong" : ""}`}>
      <span className="l">{label}</span>
      {parts.map((p) => (
        <span key={p} className={`ms-pill ${strong ? "is-ok" : "is-neutral"}`}>
          {p}
        </span>
      ))}
    </div>
  );
}

// Total de séances (Plannings / Pointages). `variant` choisit les compteurs affichés.
export function TotalsLine({
  label,
  totals,
  variant,
  strong = false,
}: {
  label: string;
  totals: Totals;
  variant: "planning" | "pointages";
  strong?: boolean;
}) {
  const parts =
    variant === "pointages"
      ? [
          `${totals.seances} séance${plural(totals.seances)}`,
          `${totals.inscrits} inscrit${plural(totals.inscrits)}`,
          `${totals.presents} présent${plural(totals.presents)}`,
          `${totals.absents} absent${plural(totals.absents)}`,
        ]
      : [
          `${totals.seances} séance${plural(totals.seances)}`,
          `${totals.inscrits} inscrit${plural(totals.inscrits)}`,
          `${totals.enfants} enfant${plural(totals.enfants)}`,
          `${totals.accompagnants} accompagnant${plural(totals.accompagnants)}`,
        ];
  return <TotalsBar label={label} parts={parts} strong={strong} />;
}
