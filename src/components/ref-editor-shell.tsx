"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { AlertGlyph, InfoGlyph, SaveGlyph } from "@/components/ui-glyphs";

/**
 * Échafaudage partagé des éditeurs de référentiels « mode tampon »
 * (RefEditor générique, NiveauxEditor, ServicesEditor) — refonte Dom 2026-09-09 :
 * barre d'outils (signalement à gauche, erreur, bouton d'ajout nommé), en-têtes de
 * colonnes, ligne avec état (nouveau / modifié : filet coloré + pastille), bandeau de
 * confirmation de suppression, pied avec compteur de modifications non enregistrées.
 * Le rendu des CELLULES reste propre à chaque éditeur. Styles : classes `.rf-*`.
 */

export type RefRowState = "new" | "modified" | null;

export function RefEditorHeader({
  error,
  onAdd,
  addLabel = "Ajouter",
  addDisabled = false,
  summary,
}: {
  error: string | null;
  onAdd: () => void;
  /** Libellé du bouton d'ajout, ex. « Ajouter un service ». */
  addLabel?: string;
  addDisabled?: boolean;
  /** Signalement à gauche (pastille), ex. « 3 sans e-mail de contact ». */
  summary?: ReactNode;
}) {
  return (
    <div className="rf-toolbar">
      {summary}
      {error && (
        <span className="ms-pill is-warn" role="alert">
          <AlertGlyph size={11} /> {error}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onAdd}
        disabled={addDisabled}
        style={{
          fontSize: ".68rem",
          padding: ".25rem .65rem",
          display: "inline-flex",
          alignItems: "center",
          gap: ".35rem",
        }}
      >
        ＋ {addLabel}
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
    <div className="rf-head" style={{ gridTemplateColumns: gridTemplate }}>
      {children}
    </div>
  );
}

/** Ligne de référentiel : grille + filet d'état (nouveau / modifié). Props HTML passées au div. */
export function RefRow({
  gridTemplate,
  state,
  style,
  className,
  children,
  ...rest
}: {
  gridTemplate: string;
  state: RefRowState;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const cls = `rf-row${state === "new" ? " is-new" : state === "modified" ? " is-mod" : ""}${
    className ? ` ${className}` : ""
  }`;
  return (
    <div className={cls} style={{ gridTemplateColumns: gridTemplate, ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Pastille d'état d'une ligne (« nouveau » / « modifié »), ou rien. */
export function RefStatePill({ state }: { state: RefRowState }) {
  if (state === "new") return <span className="ms-pill is-ok">nouveau</span>;
  if (state === "modified") return <span className="ms-pill is-warn">modifié</span>;
  return null;
}

/** Style d'un champ fantôme (libellé, e-mail) : nu au repos, cadré au survol / focus. */
export const RF_GHOST: CSSProperties = {
  fontSize: ".8rem",
  color: "var(--text)",
  border: "1px solid transparent",
  background: "transparent",
  outline: "none",
  borderRadius: "var(--rad-sm)",
  padding: ".2rem .5rem",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export function RefDeleteConfirm({
  gridColumn,
  message,
  extra,
  onConfirm,
  onCancel,
}: {
  gridColumn: string;
  message: ReactNode;
  extra?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rf-confirm" style={{ gridColumn }}>
      <AlertGlyph size={15} />
      <span style={{ flex: 1 }}>
        {message}
        {extra}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onCancel}
        style={{ fontSize: ".68rem", padding: ".22rem .6rem" }}
      >
        Annuler
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onConfirm}
        style={{
          fontSize: ".68rem",
          padding: ".22rem .65rem",
          background: "var(--danger)",
          border: "none",
          color: "#fff",
        }}
      >
        Supprimer
      </button>
    </div>
  );
}

export function RefEmptyState({ children }: { children: ReactNode }) {
  return <div className="rf-empty">{children}</div>;
}

export function RefEditorFooter({
  dirty,
  changes,
  saving,
  onCancel,
  onSave,
  onClose,
}: {
  dirty: boolean;
  /** Nombre de lignes créées, modifiées ou supprimées (compteur du pied). */
  changes: number;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  onClose?: () => void;
}) {
  const btn = {
    fontSize: ".7rem",
    padding: ".25rem .7rem",
    display: "inline-flex",
    alignItems: "center",
    gap: ".35rem",
  } as const;
  return (
    <div className="rf-foot">
      {dirty ? (
        <span className="rf-foot-msg is-dirty">
          <AlertGlyph size={13} />
          {changes > 0
            ? `${changes} modification${changes > 1 ? "s" : ""} non enregistrée${changes > 1 ? "s" : ""}`
            : "Modification en cours"}{" "}
          · rien n&apos;est écrit avant « Enregistrer »
        </span>
      ) : (
        <span className="rf-foot-msg">
          <InfoGlyph size={13} />
          Les modifications ne sont écrites qu&apos;à « Enregistrer ».
        </span>
      )}
      <span style={{ flex: 1 }} />
      {dirty ? (
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
            style={btn}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
            style={btn}
          >
            <SaveGlyph size={13} /> {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onClose?.()}
          disabled={saving}
          style={btn}
        >
          Fermer
        </button>
      )}
    </div>
  );
}
