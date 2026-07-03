"use client";

import { RefEditor } from "@/components/ref-editor";
import { createStructureAction, deleteStructureAction, updateStructureAction } from "./actions";

type DemandeurOption = { id: number; label: string };
type Initial = { id: number; label: string; demandeurId: number; users: number };
type Row = { id: number | null; label: string; demandeurId: number; users: number };

// minmax(0, 1fr) (et non « 1fr » = minmax(auto, 1fr)) : la 1re colonne ne se dimensionne pas
// sur le min-content de son contenu, sinon les colonnes se désalignent entre en-tête et lignes
// dans une modale étroite (cf. demandeurs-editor).
const GRID = "minmax(0, 1fr) 170px 64px 80px";

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
 * Éditeur des structures (modale du référentiel, Administration > Configuration).
 * MODE TAMPON via `RefEditor`. Chaque structure est rattachée à un demandeur (obligatoire).
 */
export function StructuresEditor({
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
      addDisabled={demandeurs.length === 0}
      fromInitial={(s) => ({
        id: s.id,
        label: s.label,
        demandeurId: s.demandeurId,
        users: s.users,
      })}
      blankRow={() => ({
        id: null,
        label: "",
        demandeurId: demandeurs[0]?.id ?? 0,
        users: 0,
      })}
      labels={{
        placeholder: "Nom de la structure",
        header: "Structure",
        confirm: "Supprimer ?",
        deleteTitle: "Supprimer cette structure",
        empty: "Aucune structure. Cliquez sur « Ajouter ».",
      }}
      extraHeaders={[{ label: "Demandeur" }, { label: "Usagers", style: { textAlign: "center" } }]}
      isValid={(r) => r.label.trim() !== "" && r.demandeurId > 0}
      isDirty={(r, init) => init.label !== r.label.trim() || init.demandeurId !== r.demandeurId}
      onCreate={(r) => createStructureAction({ label: r.label.trim(), demandeurId: r.demandeurId })}
      onUpdate={(id, r) =>
        updateStructureAction(id, { label: r.label.trim(), demandeurId: r.demandeurId })
      }
      onDelete={(id) => deleteStructureAction(id)}
      confirmExtra={(r) => (r.users > 0 ? ` ${r.users} usager(s) détaché(s).` : null)}
      renderExtraCells={(r, patch) => (
        <>
          <select
            value={r.demandeurId}
            onChange={(e) => patch(r.key, { demandeurId: Number(e.target.value) })}
            style={SELECT_STYLE}
          >
            {demandeurs.length === 0 && <option value={0}>— aucun demandeur —</option>}
            {demandeurs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <span style={{ textAlign: "center", fontSize: ".8rem", color: "var(--muted)" }}>
            {r.id == null ? "—" : r.users}
          </span>
        </>
      )}
    />
  );
}
