"use client";

export function PrintButton({ label = "🖨 Imprimer" }: { label?: string }) {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      style={{
        fontSize: ".78rem",
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
