"use client";

import { RefEditor } from "@/components/ref-editor";
import { Switch } from "@/components/switch";
import { createDemandeurAction, deleteDemandeurAction, updateDemandeurAction } from "./actions";

type Initial = {
  id: number;
  label: string;
  openOnSchoolHolidays: boolean;
  structureLibre: boolean;
  accueilLoisirs: boolean;
};
type Row = {
  id: number | null;
  label: string;
  openOnSchoolHolidays: boolean;
  structureLibre: boolean;
  accueilLoisirs: boolean;
};

// minmax(0, 1fr) (et non « 1fr » = minmax(auto, 1fr)) : la 1re colonne ne se dimensionne PAS
// sur le min-content de son contenu (l'input des lignes est plus large que le span de l'en-tête),
// sinon les colonnes ne s'alignent plus entre en-tête et lignes quand la modale est étroite.
const GRID = "minmax(0, 1fr) 130px 120px 130px 30px";

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
        structureLibre: d.structureLibre,
        accueilLoisirs: d.accueilLoisirs,
      })}
      blankRow={() => ({
        id: null,
        label: "",
        openOnSchoolHolidays: true,
        structureLibre: false,
        accueilLoisirs: false,
      })}
      labels={{
        placeholder: "Nom du demandeur",
        header: "Demandeur",
        add: "Ajouter un demandeur",
        confirm: (r) => (
          <>
            Supprimer <strong>{r.label || "ce demandeur"}</strong> ? Ses structures et ses niveaux
            disparaissent avec lui, ses usagers restent sans rattachement.
          </>
        ),
        deleteTitle: "Supprimer ce demandeur",
        empty: "Aucun demandeur. Cliquez sur « Ajouter un demandeur ».",
      }}
      summary={(rows) => {
        const n = rows.filter((r) => r.openOnSchoolHolidays).length;
        return (
          <span className={`ms-pill ${n > 0 ? "is-ok" : "is-neutral"}`}>
            {n} ouvert{n > 1 ? "s" : ""} pendant les vacances
          </span>
        );
      }}
      extraHeaders={[
        { label: "Ouvert vacances", style: { textAlign: "center" } },
        { label: "Structure libre", style: { textAlign: "center" } },
        { label: "Accueil de loisirs", style: { textAlign: "center" } },
      ]}
      isDirty={(r, init) =>
        init.label !== r.label.trim() ||
        init.openOnSchoolHolidays !== r.openOnSchoolHolidays ||
        init.structureLibre !== r.structureLibre ||
        init.accueilLoisirs !== r.accueilLoisirs
      }
      onCreate={(r) =>
        createDemandeurAction({
          label: r.label.trim(),
          openOnSchoolHolidays: r.openOnSchoolHolidays,
          structureLibre: r.structureLibre,
          accueilLoisirs: r.accueilLoisirs,
        })
      }
      onUpdate={(id, r) =>
        updateDemandeurAction(id, {
          label: r.label.trim(),
          openOnSchoolHolidays: r.openOnSchoolHolidays,
          structureLibre: r.structureLibre,
          accueilLoisirs: r.accueilLoisirs,
        })
      }
      onDelete={(id) => deleteDemandeurAction(id)}
      renderExtraCells={(r, patch) => (
        <>
          <span style={{ display: "flex", justifyContent: "center" }}>
            <Switch
              size="sm"
              on={r.openOnSchoolHolidays}
              onChange={(v) => patch(r.key, { openOnSchoolHolidays: v })}
            />
          </span>
          {/* Catégorie fourre-tout (« Autres ») : à l'inscription, l'usager TAPE le
              nom de sa structure au lieu de le choisir. Le libellé rejoint alors le
              référentiel sous cette catégorie — visible et modifiable dans l'éditeur
              des structures, jamais proposé au public. */}
          <span style={{ display: "flex", justifyContent: "center" }}>
            <Switch
              size="sm"
              on={r.structureLibre}
              onChange={(v) => patch(r.key, { structureLibre: v })}
            />
          </span>
          {/* Périmètre du rôle « Direction des accueils de loisirs » : ces comptes ne
              voient que les services acceptant une catégorie cochée ici, et que les
              réservations de ces catégories. */}
          <span style={{ display: "flex", justifyContent: "center" }}>
            <Switch
              size="sm"
              on={r.accueilLoisirs}
              onChange={(v) => patch(r.key, { accueilLoisirs: v })}
            />
          </span>
        </>
      )}
    />
  );
}
