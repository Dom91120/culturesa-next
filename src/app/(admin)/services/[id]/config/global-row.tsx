"use client";

/**
 * Ligne d'un réglage service-global, même anatomie que les lignes de l'onglet Échanges
 * (`.ex-krow`) : pictogramme teinté, intitulé + description, contrôle à droite.
 * Partagée par le panneau de configuration et le bloc « Validation & auto-validation ».
 * `below` : contenu rendu SOUS l'intitulé, sur la largeur texte + contrôle (zone de texte…).
 */
export function GlobalRow({
  icon,
  label,
  desc,
  disabled = false,
  below,
  children,
}: {
  /** Pictogramme (ex. `<span className="rg-ico is-ok"><LockGlyph size={14} /></span>`). */
  icon?: React.ReactNode;
  label: string;
  desc: string;
  /** Grise l'intitulé et la description (ex. réglage sans effet dans l'état courant). */
  disabled?: boolean;
  below?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="ex-krow cfg-row">
      {icon ?? <span className="rg-ico is-neutral" />}
      <div style={{ minWidth: 0, opacity: disabled ? 0.45 : 1 }}>
        <div className="ex-knm">{label}</div>
        <div className="cfg-kds">{desc}</div>
      </div>
      {children ?? <span />}
      {below && <div className="cfg-below">{below}</div>}
    </div>
  );
}
