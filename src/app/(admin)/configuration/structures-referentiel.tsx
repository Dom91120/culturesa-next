"use client";

import { StructuresEditor } from "../structures/structures-editor";
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
  return (
    <ReferentielEntry title="Structures" subtitle="Structures rattachées aux demandeurs">
      {(close) => <StructuresEditor initial={structures} demandeurs={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
