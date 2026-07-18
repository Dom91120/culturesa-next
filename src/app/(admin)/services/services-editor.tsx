"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
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
import type { ActionState } from "@/lib/action-state";
import { deleteServicesAction, saveServiceFromModalAction } from "./actions";
import { ICON_CATEGORIES } from "./legacy-icons";

type Initial = { id: string; label: string; icon: string | null };
type Row = { id: string | null; label: string; icon: string | null };

const GRID = "40px 1fr 80px";

/** `ActionState` est nullable (contrat `useActionState`) ; `useBufferedRows` attend un résultat non-nul. */
function toRefResult(res: ActionState): RefActionResult {
  return res ?? { ok: true };
}

/**
 * Éditeur des services (modale du référentiel, Administration > Configuration).
 * MODE TAMPON (comme Demandeurs) : modifications locales jusqu'au clic sur « Enregistrer ».
 * Édition en ligne du nom + sélecteur d'icône par ligne.
 */
export function ServicesEditor({ initial, onClose }: { initial: Initial[]; onClose?: () => void }) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  // Ligne dont le sélecteur d'icône est ouvert (null = fermé).
  const [pickerKey, setPickerKey] = useState<string | null>(null);

  // Logique « mode tampon » mutualisée avec RefEditor/NiveauxEditor (état, dirty, resync,
  // saveAll). Icône/sélecteur restent propres à ce composant et sont remis à zéro via
  // onSyncReset.
  const { rows, patch, addRow, removeRow, dirty, error, saving, saveAll, cancelEdits } =
    useBufferedRows<string, Initial, Row>({
      initial,
      fromInitial: (s) => ({ id: s.id, label: s.label, icon: s.icon }),
      isValid: (r) => r.label.trim() !== "",
      isDirty: (r, init) =>
        init.label !== r.label.trim() || (init.icon ?? null) !== (r.icon ?? null),
      onCreate: (r) =>
        saveServiceFromModalAction({ label: r.label.trim(), icon: r.icon }).then(toRefResult),
      onUpdate: (id, r) =>
        saveServiceFromModalAction({ id, label: r.label.trim(), icon: r.icon }).then(toRefResult),
      onDelete: (id) => deleteServicesAction([id]).then(toRefResult),
      onSyncReset: () => {
        setConfirmKey(null);
        setPickerKey(null);
      },
    });

  function add() {
    addRow({ id: null, label: "", icon: null });
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    removeRow(key);
  }

  return (
    <div>
      <RefEditorHeader error={error} onAdd={add} />

      <RefColumnHeaders gridTemplate={GRID}>
        <span style={{ textAlign: "center" }}>Icône</span>
        <span style={{ paddingLeft: ".5rem" }}>Service</span>
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
              gridTemplateColumns: GRID,
              gap: ".75rem",
              alignItems: "center",
              padding: ".2rem .75rem",
              borderRadius: "var(--rad-sm)",
            }}
          >
            <button
              type="button"
              onClick={() => setPickerKey(r.key)}
              title="Choisir une icône"
              style={{
                width: 30,
                height: 30,
                fontSize: "1.1rem",
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                background: "var(--surface2)",
                cursor: "pointer",
                justifySelf: "center",
                lineHeight: 1,
              }}
            >
              {r.icon || "🎯"}
            </button>

            {confirming ? (
              <RefDeleteConfirm
                gridColumn="2 / 4"
                message="Supprimer ce service et toutes ses données ?"
                onConfirm={() => remove(r.key)}
                onCancel={() => setConfirmKey(null)}
              />
            ) : (
              <>
                <input
                  type="text"
                  className="dem-ghost"
                  value={r.label}
                  placeholder="Nom du service"
                  onChange={(e) => patch(r.key, { label: e.target.value })}
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
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title="Supprimer ce service"
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

      {rows.length === 0 && <RefEmptyState>Aucun service. Cliquez sur « Ajouter ».</RefEmptyState>}

      {/* Pied : « Fermer » au repos ; « Annuler / Enregistrer » dès qu'une modification
          ou création est en cours. */}
      <RefEditorFooter
        dirty={dirty}
        saving={saving}
        onCancel={cancelEdits}
        onSave={saveAll}
        onClose={onClose}
      />

      {/* Sélecteur d'icône (cible la ligne `pickerKey`) : ModalOverlay partagé —
          fermeture au clic sur le fond ET à Échap (l'ancien overlay recodé à la main
          ignorait Échap, cf. audit 2026-07-17). */}
      {pickerKey !== null && (
        <ModalOverlay
          onClose={() => setPickerKey(null)}
          boxStyle={{ maxWidth: 480, width: "92%", maxHeight: "80vh", overflowY: "auto" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "1rem",
            }}
          >
            <span style={{ fontSize: ".95rem", fontWeight: 600, color: "var(--text)" }}>
              Choisir une icône
            </span>
            <button
              type="button"
              onClick={() => setPickerKey(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "1.2rem",
                color: "var(--muted)",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} style={{ marginBottom: ".85rem" }}>
              <div
                style={{
                  fontSize: ".62rem",
                  fontWeight: 700,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: ".3rem",
                }}
              >
                {cat.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {cat.icons.map((ic) => (
                  <button
                    type="button"
                    key={ic}
                    onClick={() => {
                      patch(pickerKey, { icon: ic });
                      setPickerKey(null);
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      fontSize: "1.15rem",
                      border: "2px solid transparent",
                      borderRadius: 6,
                      background: "var(--surface2)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </ModalOverlay>
      )}

      <style>{DEM_ROW_HOVER_CSS + DEM_GHOST_HOVER_CSS}</style>
    </div>
  );
}
