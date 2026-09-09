"use client";

import { type CSSProperties, type ReactNode, useState } from "react";
import { TrashGlyph } from "@/app/(admin)/users/account-ui";
import {
  RefColumnHeaders,
  RefDeleteConfirm,
  RefEditorFooter,
  RefEditorHeader,
  RefEmptyState,
  RefRow,
  RefStatePill,
  RF_GHOST,
} from "@/components/ref-editor-shell";
import { type RefActionResult, useBufferedRows } from "@/components/use-buffered-rows";

type RowBase = { id: number | null; label: string };

/**
 * Éditeur CRUD générique « en mode tampon » des référentiels à id numérique
 * (demandeurs / structures). Mutualise état, diff create/update/delete, barre d'outils,
 * ligne avec état + confirmation de suppression, pied Annuler/Enregistrer (audit R1,
 * refonte Dom 2026-09-09). La 1re colonne est toujours le libellé (champ fantôme +
 * pastille d'état) ; les colonnes intermédiaires sont fournies par `renderExtraCells`.
 * NB : services-editor et niveaux-editor restent à part (modèles divergents).
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
  summary,
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
    /** Libellé du bouton d'ajout, ex. « Ajouter un demandeur ». */
    add: string;
    /** Message de confirmation de suppression (reçoit la ligne). */
    confirm: (row: Row) => ReactNode;
    /** `title` du bouton corbeille, ex. « Supprimer ce demandeur ». */
    deleteTitle: string;
    /** Texte d'état vide. */
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
  /** Signalement à gauche de la barre d'outils (calculé sur les lignes courantes). */
  summary?: (rows: Row[]) => ReactNode;
  addDisabled?: boolean;
  onClose?: () => void;
}) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Logique « mode tampon » mutualisée (état des lignes, dirty, resync, saveAll, cancel).
  const {
    rows,
    patch,
    addRow,
    removeRow,
    dirty,
    changes,
    rowState,
    error,
    saving,
    saveAll,
    cancelEdits,
  } = useBufferedRows<number, Init, Row>({
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
      <RefEditorHeader
        error={error}
        onAdd={add}
        addLabel={labels.add}
        addDisabled={addDisabled}
        summary={summary?.(rows)}
      />

      <RefColumnHeaders gridTemplate={gridTemplate}>
        <span style={{ paddingLeft: ".5rem" }}>{labels.header}</span>
        {extraHeaders.map((h, i) => (
          <span key={i} style={h.style}>
            {h.label}
          </span>
        ))}
        <span />
      </RefColumnHeaders>

      {rows.map((r) => {
        const confirming = confirmKey === r.key;
        const state = rowState(r);
        return (
          <RefRow key={r.key} gridTemplate={gridTemplate} state={state}>
            <div className="rf-label">
              <input
                type="text"
                className="rf-ghost"
                value={r.label}
                placeholder={labels.placeholder}
                disabled={saving}
                onChange={(e) => patch(r.key, { label: e.target.value } as Partial<Row>)}
                style={{ ...RF_GHOST, fontWeight: 600 }}
              />
              <RefStatePill state={state} />
            </div>

            {confirming ? (
              <RefDeleteConfirm
                gridColumn={`2 / ${confirmSpanEnd}`}
                message={labels.confirm(r)}
                extra={confirmExtra?.(r)}
                onConfirm={() => remove(r.key)}
                onCancel={() => setConfirmKey(null)}
              />
            ) : (
              <>
                {renderExtraCells(r, patch)}
                <div className="rf-act">
                  <button
                    type="button"
                    className="acct-action is-danger"
                    onClick={() => setConfirmKey(r.key)}
                    title={labels.deleteTitle}
                    aria-label={labels.deleteTitle}
                  >
                    <TrashGlyph size={14} />
                  </button>
                </div>
              </>
            )}
          </RefRow>
        );
      })}

      {rows.length === 0 && <RefEmptyState>{labels.empty}</RefEmptyState>}

      <RefEditorFooter
        dirty={dirty}
        changes={changes}
        saving={saving}
        onCancel={cancelEdits}
        onSave={saveAll}
        onClose={onClose}
      />
    </div>
  );
}
