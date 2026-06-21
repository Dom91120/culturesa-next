"use client";

const ICON: React.SVGProps<SVGSVGElement> = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function StatsToolbar({ exportHref }: { exportHref: string }) {
  const btn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: ".78rem",
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface1)",
    color: "var(--text)",
    cursor: "pointer",
    textDecoration: "none",
  };
  return (
    <div className="no-print" style={{ display: "flex", gap: ".5rem" }}>
      <a href={exportHref} style={btn}>
        {/* Téléchargement (export CSV) */}
        <svg {...ICON}>
          <title>Exporter en CSV</title>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Exporter (CSV)
      </a>
      <button type="button" onClick={() => window.print()} style={btn}>
        {/* Imprimante */}
        <svg {...ICON}>
          <title>Imprimer</title>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        Imprimer
      </button>
    </div>
  );
}
