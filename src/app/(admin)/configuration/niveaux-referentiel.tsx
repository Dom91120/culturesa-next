"use client";

import { ListNumbersGlyph } from "@/components/ui-glyphs";

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
  const nbDem = new Set(niveaux.map((n) => n.demandeurId).filter((d) => d !== null)).size;
  const communs = niveaux.filter((n) => n.demandeurId === null).length;
  return (
    <ReferentielEntry
      title="Niveaux"
      icon={
        <span className="rg-ico is-warn">
          <ListNumbersGlyph size={14} />
        </span>
      }
      count={niveaux.length}
      subtitle="Classification par demandeur, utilisée dans le profil des usagers et les statistiques. L'ordre se règle par glisser-déposer au sein d'un même demandeur."
      detail={
        [
          nbDem > 0 ? `répartis sur ${nbDem} demandeur${nbDem > 1 ? "s" : ""}` : null,
          communs > 0 ? `${communs} commun${communs > 1 ? "s" : ""} à tous` : null,
        ]
          .filter((p): p is string => p !== null)
          .join(" · ") || "aucun niveau"
      }
    >
      {(close) => <NiveauxEditor initial={niveaux} demandeurs={demandeurs} onClose={close} />}
    </ReferentielEntry>
  );
}
