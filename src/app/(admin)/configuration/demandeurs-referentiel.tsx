"use client";

import { DemandeursEditor } from "../demandeurs/demandeurs-editor";
import { SchoolGlyph } from "../users/account-ui";
import { ReferentielEntry } from "./referentiel-entry";

type Demandeur = {
  id: number;
  label: string;
  openOnSchoolHolidays: boolean;
  structureLibre: boolean;
  accueilLoisirs: boolean;
};

/** Entrée « Demandeurs » du panneau Référentiels (modale + `DemandeursEditor`, mode tampon). */
export function DemandeursReferentiel({ demandeurs }: { demandeurs: Demandeur[] }) {
  const ouverts = demandeurs.filter((d) => d.openOnSchoolHolidays).length;
  const libres = demandeurs.filter((d) => d.structureLibre).length;
  const loisirs = demandeurs.filter((d) => d.accueilLoisirs).length;
  const parts = [
    ouverts > 0 ? `${ouverts} ouvert${ouverts > 1 ? "s" : ""} pendant les vacances` : null,
    libres > 0 ? `${libres} à structure libre` : null,
    loisirs > 0 ? `${loisirs} accueil${loisirs > 1 ? "s" : ""} de loisirs` : null,
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
      subtitle="Établissements et organismes auxquels les usagers se rattachent. « Ouvert vacances » autorise leurs usagers à réserver ces jours-là si le service l'est aussi ; « structure libre » laisse l'usager taper le nom de sa structure à l'inscription ; « accueil de loisirs » délimite ce que voit la Direction des accueils de loisirs."
      detail={parts.length ? parts : "aucun ouvert pendant les vacances"}
      maxWidth={860}
    >
      {(close) => <DemandeursEditor initial={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
