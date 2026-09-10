"use client";

const ICON: React.SVGProps<SVGSVGElement> = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function StatsToolbar({ exportHref }: { exportHref: string }) {
  // Boutons icône seule (sans libellé), en pictogrammes d'action comme les listes RGPD /
  // Échanges ; le nom accessible vient d'aria-label / title.
  return (
    <div className="no-print ms-acts" style={{ opacity: 1 }}>
      <a
        href={exportHref}
        className="acct-action"
        title="Exporter en CSV"
        aria-label="Exporter en CSV"
      >
        <svg {...ICON}>
          <title>Exporter en CSV</title>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="acct-action"
        title="Imprimer"
        aria-label="Imprimer"
      >
        <svg {...ICON}>
          <title>Imprimer</title>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      </button>
    </div>
  );
}
