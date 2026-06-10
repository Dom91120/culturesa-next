"use client";

export function StatsToolbar({ exportHref }: { exportHref: string }) {
  const btn: React.CSSProperties = {
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
        ⬇ Exporter (CSV)
      </a>
      <button type="button" onClick={() => window.print()} style={btn}>
        🖨 Imprimer
      </button>
    </div>
  );
}
