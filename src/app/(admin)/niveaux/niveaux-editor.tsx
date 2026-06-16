"use client";

import { RefEditor } from "@/components/ref-editor";
import { createNiveauAction, deleteNiveauAction, updateNiveauAction } from "./actions";

type DemandeurOption = { id: number; label: string };
type Initial = { id: number; label: string; demandeurId: number | null; position: number };
type Row = { id: number | null; label: string; demandeurId: number | null; position: number };

const GRID = "1fr 170px 70px 80px";

const SELECT_STYLE = {
  fontSize: ".78rem",
  padding: ".2rem .35rem",
  borderRadius: "var(--rad-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text)",
  width: "100%",
} as const;

/**
 * Éditeur des niveaux scolaires (modale du référentiel, Administration > Configuration).
 * MODE TAMPON via `RefEditor`. Demandeur optionnel, position d'ordre.
 */
export function NiveauxEditor({
  initial,
  demandeurs,
  onClose,
}: {
  initial: Initial[];
  demandeurs: DemandeurOption[];
  onClose?: () => void;
}) {
  return (
    <RefEditor<Initial, Row>
      initial={initial}
      onClose={onClose}
      gridTemplate={GRID}
      fromInitial={(n) => ({
        id: n.id,
        label: n.label,
        demandeurId: n.demandeurId,
        position: n.position,
      })}
      blankRow={() => ({ id: null, label: "", demandeurId: null, position: 0 })}
      labels={{
        placeholder: "Nom du niveau",
        header: "Niveau",
        confirm: "Supprimer ce niveau ?",
        deleteTitle: "Supprimer ce niveau",
        empty: "Aucun niveau. Cliquez sur « Ajouter ».",
      }}
      extraHeaders={[{ label: "Demandeur" }, { label: "Position", style: { textAlign: "center" } }]}
      isDirty={(r, init) =>
        init.label !== r.label.trim() ||
        init.demandeurId !== r.demandeurId ||
        init.position !== r.position
      }
      onCreate={(r) =>
        createNiveauAction({
          label: r.label.trim(),
          demandeurId: r.demandeurId,
          position: r.position,
        })
      }
      onUpdate={(id, r) =>
        updateNiveauAction(id, {
          label: r.label.trim(),
          demandeurId: r.demandeurId,
          position: r.position,
        })
      }
      onDelete={(id) => deleteNiveauAction(id)}
      renderExtraCells={(r, patch) => (
        <>
          <select
            value={r.demandeurId ?? ""}
            onChange={(e) =>
              patch(r.key, {
                demandeurId: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            style={SELECT_STYLE}
          >
            <option value="">— aucun —</option>
            {demandeurs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={r.position}
            onChange={(e) => patch(r.key, { position: Math.max(0, Number(e.target.value) || 0) })}
            style={{
              fontSize: ".78rem",
              padding: ".2rem .35rem",
              borderRadius: "var(--rad-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text)",
              width: "100%",
              textAlign: "center",
              boxSizing: "border-box",
            }}
          />
        </>
      )}
    />
  );
}
