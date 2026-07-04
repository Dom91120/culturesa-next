"use client";

// `iconOnly` : bouton compact icône seule (SVG imprimante, repris de l'agenda), sans
// libellé — le nom accessible vient de `title` / `aria-label`. Sinon bouton avec libellé texte.
export function PrintButton({
  label = "🖨 Imprimer",
  iconOnly = false,
  title = "Imprimer",
  href,
}: {
  label?: string;
  iconOnly?: boolean;
  title?: string;
  // Si fourni : le bouton ouvre ce lien (ex. PDF serveur) au lieu de window.print().
  href?: string;
}) {
  if (iconOnly) {
    const iconStyle: React.CSSProperties = {
      background: "none",
      border: "1px solid var(--border)",
      borderRadius: "var(--rad-sm)",
      padding: ".28rem .38rem",
      cursor: "pointer",
      color: "var(--muted)",
      display: "flex",
      alignItems: "center",
      lineHeight: 1,
    };
    const icon = (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
    );
    if (href) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener"
          className="no-print"
          title={title}
          aria-label={title}
          style={iconStyle}
        >
          {icon}
        </a>
      );
    }
    return (
      <button
        type="button"
        className="no-print"
        onClick={() => window.print()}
        title={title}
        aria-label={title}
        style={iconStyle}
      >
        {icon}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      title={title}
      style={{
        fontSize: ".78rem",
        lineHeight: 1,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface1)",
        color: "var(--text)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
