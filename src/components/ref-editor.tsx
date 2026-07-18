"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import {
  DEM_GHOST_HOVER_CSS,
  DEM_ROW_HOVER_CSS,
  RefColumnHeaders,
  RefDeleteConfirm,
  RefEditorFooter,
  RefEditorHeader,
  RefEmptyState,
} from "@/components/ref-editor-shell";
import { GHOST_DANGER_STYLE } from "@/components/ui-styles";
import { type RefActionResult, useBufferedRows } from "@/components/use-buffered-rows";

type RowBase = { id: number | null; label: string };

/**
 * Éditeur CRUD générique « en mode tampon » des référentiels à id numérique
 * (demandeurs / structures / niveaux). Mutualise état, diff create/update/delete,
 * en-tête, ligne + confirmation de suppression, pied Annuler/Enregistrer et styles
 * (audit R1). La 1re colonne est toujours le libellé (input texte) ; les colonnes
 * intermédiaires sont fournies par `renderExtraCells`. NB : services-editor reste à
 * part (id texte + icône en 1re colonne + sélecteur d'icône → modèle divergent).
 */
export function RefEditor<Init extends { id: number; label: string }, Row extends RowBase>({
  initial,
  fromInitial,
  blankRow,
  gridTemplate,
  labels,
  extraHeaders,
  renderExtraCells,
  isValid = (r) => r.label.trim() !== "",
  isDirty,
  onCreate,
  onUpdate,
  onDelete,
  confirmExtra,
  addDisabled = false,
  onClose,
}: {
  initial: Init[];
  /** Mappe une entrée initiale vers une ligne d'édition (sans `key`, ajouté en interne). */
  fromInitial: (init: Init) => Row;
  /** Ligne vierge pour « Ajouter » (id null + valeurs par défaut, sans `key`). */
  blankRow: () => Row;
  gridTemplate: string;
  labels: {
    /** Placeholder de l'input libellé, ex. « Nom du demandeur ». */
    placeholder: string;
    /** En-tête de la colonne libellé, ex. « Demandeur ». */
    header: ReactNode;
    /** Message de confirmation de suppression, ex. « Supprimer ce demandeur ? ». */
    confirm: string;
    /** `title` du bouton corbeille, ex. « Supprimer ce demandeur ». */
    deleteTitle: string;
    /** Texte d'état vide, ex. « Aucun demandeur. Cliquez sur « Ajouter ». ». */
    empty: string;
  };
  /** En-têtes des colonnes intermédiaires (entre libellé et Action). */
  extraHeaders: { label: ReactNode; style?: CSSProperties }[];
  /** Cellules intermédiaires d'une ligne (mode normal). */
  renderExtraCells: (
    row: Row & { key: string },
    patch: (key: string, p: Partial<Row>) => void,
  ) => ReactNode;
  /** Validité d'une ligne (création ET mise à jour). Défaut : libellé non vide. */
  isValid?: (row: Row) => boolean;
  /** La ligne diffère-t-elle de son état initial ? (déclenche un update) */
  isDirty: (row: Row, init: Init) => boolean;
  onCreate: (row: Row) => Promise<RefActionResult>;
  onUpdate: (id: number, row: Row) => Promise<RefActionResult>;
  onDelete: (id: number) => Promise<RefActionResult>;
  /** Détail optionnel ajouté au message de confirmation (ex. usagers détachés). */
  confirmExtra?: (row: Row) => ReactNode;
  addDisabled?: boolean;
  onClose?: () => void;
}) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Logique « mode tampon » mutualisée (état des lignes, dirty, resync, saveAll, cancel).
  const { rows, patch, addRow, removeRow, dirty, error, saving, saveAll, cancelEdits } =
    useBufferedRows<number, Init, Row>({
      initial,
      fromInitial,
      isValid,
      isDirty,
      onCreate,
      onUpdate,
      onDelete,
      onSyncReset: () => setConfirmKey(null),
    });

  function add() {
    addRow(blankRow());
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    removeRow(key);
  }

  // Confirmation : la cellule s'étend du libellé+1 jusqu'à la fin (colonnes = libellé
  // + intermédiaires + action). gridColumn 1-based, fin exclusive ⇒ extraHeaders+3.
  const confirmSpanEnd = extraHeaders.length + 3;

  return (
    <div>
      {/* En-tête : erreur éventuelle + bouton d'ajout (le titre est porté par la modale). */}
      <RefEditorHeader error={error} onAdd={add} addDisabled={addDisabled} />

      {/* En-têtes de colonnes (discrets) */}
      <RefColumnHeaders gridTemplate={gridTemplate}>
        <span style={{ paddingLeft: ".5rem" }}>{labels.header}</span>
        {extraHeaders.map((h, i) => (
          <span key={i} style={h.style}>
            {h.label}
          </span>
        ))}
        <span style={{ textAlign: "center" }}>Action</span>
      </RefColumnHeaders>

      {rows.map((r) => {
        const confirming = confirmKey === r.key;
        return (
          <div
            key={r.key}
            className="dem-row"
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplate,
              gap: ".75rem",
              alignItems: "center",
              padding: ".2rem .75rem",
              borderRadius: "var(--rad-sm)",
            }}
          >
            <input
              type="text"
              className="dem-ghost"
              value={r.label}
              placeholder={labels.placeholder}
              onChange={(e) => patch(r.key, { label: e.target.value } as Partial<Row>)}
              style={{
                fontSize: ".8rem",
                fontWeight: 600,
                color: "var(--text)",
                border: "none",
                background: "transparent",
                outline: "none",
                borderRadius: "var(--rad-sm)",
                padding: ".2rem .5rem",
                width: "100%",
              }}
            />

            {confirming ? (
              <RefDeleteConfirm
                gridColumn={`2 / ${confirmSpanEnd}`}
                message={labels.confirm}
                extra={confirmExtra?.(r)}
                onConfirm={() => remove(r.key)}
                onCancel={() => setConfirmKey(null)}
              />
            ) : (
              <>
                {renderExtraCells(r, patch)}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title={labels.deleteTitle}
                  style={{
                    fontSize: ".75rem",
                    padding: ".15rem .4rem",
                    lineHeight: 1,
                    ...GHOST_DANGER_STYLE,
                    justifySelf: "center",
                  }}
                >
                  🗑️
                </button>
              </>
            )}
          </div>
        );
      })}

      {rows.length === 0 && <RefEmptyState>{labels.empty}</RefEmptyState>}

      {/* Pied : « Fermer » au repos ; « Annuler / Enregistrer » dès qu'une modification
          ou création est en cours (mode tampon, enregistrement explicite). */}
      <RefEditorFooter
        dirty={dirty}
        saving={saving}
        onCancel={cancelEdits}
        onSave={saveAll}
        onClose={onClose}
      />

      <style>{DEM_ROW_HOVER_CSS + DEM_GHOST_HOVER_CSS}</style>
    </div>
  );
}
