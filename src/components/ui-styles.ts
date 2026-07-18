import type { CSSProperties } from "react";

// ════════════════════════════════════════════════════════════
//  Constantes de style PARTAGÉES (audit 2026-07-17) : trois recettes recopiées
//  inline dans une douzaine de fichiers chacune, avec des divergences déjà réelles
//  (stats-filters avait dérivé du chrome standard, deux rouges danger coexistaient).
//  Chaque site n'ajoute que ses dimensions (fontSize / padding / width…).
// ════════════════════════════════════════════════════════════

/**
 * Chrome STANDARD d'un champ compact (input / select / textarea stylé inline) :
 * fond surface2, bordure, rayon et texte du thème — même recette que la règle
 * globale `input, select, textarea` de app-legacy.css.
 */
export const INPUT_CHROME: CSSProperties = {
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
};

/**
 * Titre de champ (majuscules espacées, muted) posé sur des <span>/<div> — même
 * intention que la règle globale `label` de app-legacy.css.
 */
export const FIELD_TITLE_STYLE: CSSProperties = {
  fontSize: ".65rem",
  fontWeight: 600,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

/**
 * Surcharges DANGER d'un bouton `.btn-ghost` (🗑️ des lignes d'éditeurs/tableaux) :
 * rouge du THÈME — avant l'audit, sept sites utilisaient un rouge codé en dur
 * (#e05555 / rgba(220,80,80,.4)) concurrent de var(--danger).
 */
export const GHOST_DANGER_STYLE: CSSProperties = {
  color: "var(--danger)",
  borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)",
};
