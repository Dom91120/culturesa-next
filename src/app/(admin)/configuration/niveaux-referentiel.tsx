"use client";

import { NiveauxEditor } from "../niveaux/niveaux-editor";
import { ReferentielEntry } from "./referentiel-entry";

type DemandeurOption = { id: number; label: string };
type Niveau = { id: number; label: string; demandeurId: number | null; position: number };

/** Entrée « Niveaux » du panneau Référentiels (modale + `NiveauxEditor`, mode tampon). */
export function NiveauxReferentiel({
  niveaux,
  demandeurs,
}: {
  niveaux: Niveau[];
  demandeurs: DemandeurOption[];
}) {
  return (
    <ReferentielEntry title="Niveaux" subtitle="Référentiel des niveaux scolaires">
      {(close) => <NiveauxEditor initial={niveaux} demandeurs={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
