"use client";

import { RefEditor } from "@/components/ref-editor";
import { Switch } from "@/components/switch";
import { createDemandeurAction, deleteDemandeurAction, updateDemandeurAction } from "./actions";

type Initial = { id: number; label: string; openOnSchoolHolidays: boolean };
type Row = { id: number | null; label: string; openOnSchoolHolidays: boolean };

const GRID = "1fr 190px 80px";

/**
 * Éditeur des demandeurs (modale du référentiel, Administration > Configuration).
 * MODE TAMPON via `RefEditor` : modifications locales jusqu'au clic sur « Enregistrer ».
 */
export function DemandeursEditor({
  initial,
  onClose,
}: {
  initial: Initial[];
  onClose?: () => void;
}) {
  return (
    <RefEditor<Initial, Row>
      initial={initial}
      onClose={onClose}
      gridTemplate={GRID}
      fromInitial={(d) => ({
        id: d.id,
        label: d.label,
        openOnSchoolHolidays: d.openOnSchoolHolidays,
      })}
      blankRow={() => ({ id: null, label: "", openOnSchoolHolidays: true })}
      labels={{
        placeholder: "Nom du demandeur",
        header: "Demandeur",
        confirm: "Supprimer ce demandeur ?",
        deleteTitle: "Supprimer ce demandeur",
        empty: "Aucun demandeur. Cliquez sur « Ajouter ».",
      }}
      extraHeaders={[{ label: "Ouvert vacances scolaires", style: { textAlign: "center" } }]}
      isDirty={(r, init) =>
        init.label !== r.label.trim() || init.openOnSchoolHolidays !== r.openOnSchoolHolidays
      }
      onCreate={(r) =>
        createDemandeurAction({
          label: r.label.trim(),
          openOnSchoolHolidays: r.openOnSchoolHolidays,
        })
      }
      onUpdate={(id, r) =>
        updateDemandeurAction(id, {
          label: r.label.trim(),
          openOnSchoolHolidays: r.openOnSchoolHolidays,
        })
      }
      onDelete={(id) => deleteDemandeurAction(id)}
      renderExtraCells={(r, patch) => (
        <span style={{ display: "flex", justifyContent: "center" }}>
          <Switch
            on={r.openOnSchoolHolidays}
            onChange={(v) => patch(r.key, { openOnSchoolHolidays: v })}
          />
        </span>
      )}
    />
  );
}
