// Bouton « Export CSV » icône seule (lien vers la route d'export). Même style compact que
// PrintButton (iconOnly). Le nom accessible vient de title / aria-label.
export function ExportButton({
  href,
  title = "Exporter en CSV",
}: { href: string; title?: string }) {
  return (
    <a
      href={href}
      className="no-print"
      title={title}
      aria-label={title}
      style={{
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--rad-sm)",
        padding: ".28rem .38rem",
        cursor: "pointer",
        color: "var(--muted)",
        display: "flex",
        alignItems: "center",
        lineHeight: 1,
        textDecoration: "none",
      }}
    >
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
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {/* Libellé pour lecteurs d'écran (lien icône seule). */}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {title}
      </span>
    </a>
  );
}
