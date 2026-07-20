"use client";

/**
 * Ligne d'un réglage service-global : intitulé + description à gauche, contrôle à droite.
 * Partagée par le panneau de configuration et le bloc « Validation & auto-validation ».
 * `last` retire la bordure basse (dernière ligne d'un groupe). `align` cale le contrôle
 * en haut ("start") plutôt qu'au centre — utile quand le contrôle est un bloc multi-lignes.
 */
export function GlobalRow({
  label,
  desc,
  last,
  align = "center",
  disabled = false,
  children,
}: {
  label: string;
  desc: string;
  last?: boolean;
  align?: "center" | "start";
  /** Grise l'intitulé et la description (ex. réglage sans effet dans l'état courant). */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: align === "start" ? "flex-start" : "center",
        gap: "1rem",
        padding: ".75rem 0",
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, opacity: disabled ? 0.45 : 1 }}>
        <div style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: ".15rem" }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}
