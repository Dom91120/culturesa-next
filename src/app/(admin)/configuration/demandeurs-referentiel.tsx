"use client";

import { DemandeursEditor } from "../demandeurs/demandeurs-editor";
import { ReferentielEntry } from "./referentiel-entry";

type Demandeur = { id: number; label: string; openOnSchoolHolidays: boolean };

/** Entrée « Demandeurs » du panneau Référentiels (modale + `DemandeursEditor`, mode tampon). */
export function DemandeursReferentiel({ demandeurs }: { demandeurs: Demandeur[] }) {
  return (
    <ReferentielEntry title="Demandeurs" subtitle="Référentiel des demandeurs" maxWidth={780}>
      {(close) => <DemandeursEditor initial={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
