"use client";

import { StructuresEditor } from "../structures/structures-editor";
import { BuildingGlyph } from "../users/account-ui";
import { ReferentielEntry } from "./referentiel-entry";

type DemandeurOption = { id: number; label: string };
type Structure = { id: number; label: string; demandeurId: number; users: number };

/** Entrée « Structures » du panneau Référentiels (modale + `StructuresEditor`, mode tampon). */
export function StructuresReferentiel({
  structures,
  demandeurs,
}: {
  structures: Structure[];
  demandeurs: DemandeurOption[];
}) {
  const usagers = structures.reduce((n, s) => n + s.users, 0);
  const vides = structures.filter((s) => s.users === 0).length;
  return (
    <ReferentielEntry
      title="Structures"
      icon={
        <span className="rg-ico is-neutral">
          <BuildingGlyph size={14} />
        </span>
      }
      count={structures.length}
      subtitle="Unités rattachées à un demandeur ; un usager rattaché à une structure hérite du demandeur. Supprimer une structure détache ses usagers sans les supprimer."
      countSuffix={`· ${usagers} usager${usagers > 1 ? "s" : ""} rattaché${usagers > 1 ? "s" : ""}`}
      detail={vides === 0 ? "toutes ont des usagers" : `${vides} sans aucun usager`}
      maxWidth={730}
    >
      {(close) => <StructuresEditor initial={structures} demandeurs={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
