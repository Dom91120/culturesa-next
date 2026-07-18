"use client";

import type { ReactNode } from "react";

/**
 * Échafaudage partagé des éditeurs de référentiels « mode tampon »
 * (RefEditor générique, NiveauxEditor, ServicesEditor) : en-tête (erreur + Ajouter),
 * ligne d'en-têtes de colonnes, ligne de confirmation de suppression, pied
 * Fermer/Annuler-Enregistrer, état vide et hover CSS. Le rendu des LIGNES reste
 * propre à chaque éditeur (modèles trop divergents : tampon générique vs
 * lecture-seule+édition vs icône+picker).
 */

export function RefEditorHeader({
  error,
  onAdd,
  addDisabled = false,
}: {
  error: string | null;
  onAdd: () => void;
  addDisabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: ".75rem",
        marginBottom: ".5rem",
      }}
    >
      {error && (
        <span className="field-error" style={{ fontSize: ".72rem" }}>
          {error}
        </span>
      )}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onAdd}
        disabled={addDisabled}
        style={{ fontSize: ".64rem", padding: ".18rem .5rem" }}
      >
        ＋ Ajouter
      </button>
    </div>
  );
}

export function RefColumnHeaders({
  gridTemplate,
  children,
}: {
  gridTemplate: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: gridTemplate,
        gap: ".75rem",
        alignItems: "center",
        padding: "0 .75rem .5rem",
        borderBottom: "1px solid var(--border)",
        fontSize: ".66rem",
        fontWeight: 600,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

export function RefDeleteConfirm({
  gridColumn,
  message,
  extra,
  onConfirm,
  onCancel,
}: {
  gridColumn: string;
  message: string;
  extra?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        gridColumn,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: ".5rem",
      }}
    >
      <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
        {message}
        {extra}
      </span>
      <button
        type="button"
        onClick={onConfirm}
        style={{
          border: "1px solid var(--danger)",
          background: "transparent",
          color: "var(--danger)",
          borderRadius: "var(--rad-sm)",
          fontSize: ".72rem",
          padding: ".2rem .55rem",
          cursor: "pointer",
        }}
      >
        Supprimer
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onCancel}
        style={{ fontSize: ".72rem", padding: ".2rem .55rem" }}
      >
        Annuler
      </button>
    </div>
  );
}

export function RefEmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "1.5rem",
        textAlign: "center",
        fontSize: ".82rem",
        color: "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

export function RefEditorFooter({
  dirty,
  saving,
  onCancel,
  onSave,
  onClose,
}: {
  dirty: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: ".6rem",
        marginTop: "1.25rem",
      }}
    >
      {dirty ? (
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
            style={{ fontSize: ".7rem", padding: ".22rem .65rem" }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
            style={{ fontSize: ".7rem", padding: ".22rem .75rem" }}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onClose?.()}
          disabled={saving}
          style={{ fontSize: ".7rem", padding: ".22rem .65rem" }}
        >
          Fermer
        </button>
      )}
    </div>
  );
}

/** Ligne de survol des lignes de tableau (`.dem-row`). */
export const DEM_ROW_HOVER_CSS = ".dem-row:hover{background:var(--surface2)}";
/** Survol/focus des inputs fantômes en 1re colonne (`.dem-ghost`), en plus de `DEM_ROW_HOVER_CSS`. */
export const DEM_GHOST_HOVER_CSS =
  ".dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}";
