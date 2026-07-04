"use client";

/**
 * Interrupteur fin thématisé (CSS vars). Source unique — repris de la maquette, utilisé par
 * la matrice demandeurs et le panneau de configuration de service. `disabled` force l'état
 * visuel « off » et bloque l'interaction. `size` : "md" (30×16, défaut) ou "sm" (26×16,
 * piste plus étroite ; même hauteur pour garder le pouce de 12px centré — box-sizing
 * border-box → la hauteur inclut la bordure, donc l'intérieur = hauteur − 2).
 */
export function Switch({
  on,
  onChange,
  disabled,
  size = "md",
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const active = disabled ? false : on;
  // Dimensions par taille (pouce centré verticalement, décalage on/off symétrique).
  const S =
    size === "sm"
      ? { w: 26, h: 16, knob: 12, top: 1, onLeft: 13, offLeft: 1 }
      : { w: 30, h: 16, knob: 12, top: 1, onLeft: 15, offLeft: 1 };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: "relative",
        width: S.w,
        height: S.h,
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
          top: S.top,
          left: active ? S.onLeft : S.offLeft,
          width: S.knob,
          height: S.knob,
          borderRadius: "50%",
          background: active ? "#0f1117" : "var(--muted)",
          transition: "left .2s",
          display: "block",
        }}
      />
    </button>
  );
}
