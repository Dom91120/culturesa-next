import type { Totals } from "./range";

const plural = (n: number) => (n > 1 ? "s" : "");

// En-tête de rupture (semaine / mois) dans une édition multi-périodes.
export function RuptureHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: ".95rem",
        fontWeight: 700,
        margin: "1.25rem 0 .6rem",
        padding: ".35rem .6rem",
        borderRadius: "var(--rad-sm)",
        background: "var(--accent-dim)",
        color: "var(--accent)",
        breakInside: "avoid",
      }}
    >
      {children}
    </h3>
  );
}

// Ligne de total / sous-total. `variant` choisit les compteurs affichés :
//   planning  → séances, inscrits, enfants, accompagnants
//   pointages → séances, inscrits, présents, absents
// `strong` = total général (mise en avant accent).
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
  return (
    <div
      style={{
        breakInside: "avoid",
        margin: strong ? "1rem 0 .5rem" : ".4rem 0 1rem",
        padding: ".4rem .6rem",
        fontSize: ".8rem",
        fontWeight: 600,
        color: strong ? "var(--accent)" : "var(--text)",
        background: strong ? "var(--accent-dim)" : "var(--surface2)",
        border: `1px solid ${strong ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--rad-sm)",
      }}
    >
      {label} : {parts.join(" · ")}
    </div>
  );
}
