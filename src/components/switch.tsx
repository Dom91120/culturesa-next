"use client";

/**
 * Interrupteur fin (30×16) thématisé (CSS vars). Source unique — repris de la maquette,
 * utilisé par la matrice demandeurs et le panneau de configuration de service.
 * `disabled` force l'état visuel « off » et bloque l'interaction.
 */
export function Switch({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const active = disabled ? false : on;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: 30,
        height: 16,
        borderRadius: 99,
        background: active ? "var(--accent)" : "var(--surface2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background .2s, border-color .2s",
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: active ? 15 : 1,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: active ? "#0f1117" : "var(--muted)",
          transition: "left .2s",
          display: "block",
        }}
      />
    </button>
  );
}
