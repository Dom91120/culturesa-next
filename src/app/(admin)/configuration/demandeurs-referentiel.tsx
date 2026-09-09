"use client";

import { DemandeursEditor } from "../demandeurs/demandeurs-editor";
import { SchoolGlyph } from "../users/account-ui";
import { ReferentielEntry } from "./referentiel-entry";

type Demandeur = {
  id: number;
  label: string;
  openOnSchoolHolidays: boolean;
  structureLibre: boolean;
};

/** Entrée « Demandeurs » du panneau Référentiels (modale + `DemandeursEditor`, mode tampon). */
export function DemandeursReferentiel({ demandeurs }: { demandeurs: Demandeur[] }) {
  const ouverts = demandeurs.filter((d) => d.openOnSchoolHolidays).length;
  const libres = demandeurs.filter((d) => d.structureLibre).length;
  const parts = [
    ouverts > 0 ? `${ouverts} ouvert${ouverts > 1 ? "s" : ""} pendant les vacances` : null,
    libres > 0 ? `${libres} à structure libre` : null,
  ].filter((p): p is string => p !== null);
  return (
    <ReferentielEntry
      title="Demandeurs"
      icon={
        <span className="rg-ico is-info">
          <SchoolGlyph size={14} />
        </span>
      }
      count={demandeurs.length}
      detail={parts.length ? parts.join(" · ") : "aucun ouvert pendant les vacances"}
      maxWidth={780}
    >
      {(close) => <DemandeursEditor initial={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
