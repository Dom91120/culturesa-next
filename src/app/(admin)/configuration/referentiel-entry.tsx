"use client";

import { type ReactNode, useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { ArrowUpRightGlyph } from "@/components/ui-glyphs";

/**
 * Entrée du panneau Référentiels (page Configuration) : un bouton (titre + sous-titre)
 * qui ouvre une MODALE hébergeant un éditeur en mode tampon. Mutualise les wrappers
 * services/demandeurs/structures/niveaux (audit R2). Modale de FORMULAIRE : PAS de
 * fermeture par Échap ni clic sur le fond (une saisie non enregistrée — ex. l'e-mail
 * de contact d'un service — était jetée sans avertissement, retour Dom 2026-08-31) ;
 * on ferme par « Fermer », « Annuler » ou ×.
 *
 * `children` est un render-prop recevant la fonction de fermeture, pour la passer en
 * `onClose` à l'éditeur. Les wrappers RESTENT des composants client minces (la page
 * Configuration est un composant serveur et ne peut pas passer de fonction à un enfant
 * client).
 */
export function ReferentielEntry({
  title,
  icon,
  count,
  countSuffix,
  detail,
  subtitle,
  maxWidth = 720,
  children,
}: {
  title: string;
  /** Pictogramme teinté (`.rg-ico …`), rendu par la page serveur. */
  icon: ReactNode;
  /** Effectif du référentiel, en grand. */
  count: number;
  /** Complément à côté de l'effectif (ex. « · 37 usagers rattachés »). */
  countSuffix?: string;
  /** Ligne de signalement (ce qui mérite un coup d'œil), ou état neutre. */
  detail: string;
  /** Phrase sous le titre de la modale : ce que le référentiel règle (et ne règle pas). */
  subtitle: string;
  maxWidth?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {/* Tuile (refonte Dom 2026-09-09) : toute la surface ouvre l'éditeur. */}
      <button type="button" className="cf-tile" onClick={() => setOpen(true)}>
        <span className="cf-tile-open" aria-hidden="true">
          <ArrowUpRightGlyph size={14} />
        </span>
        <span className="h">
          {icon}
          {title}
        </span>
        <span className="n">
          {count}
          {countSuffix && <small>{countSuffix}</small>}
        </span>
        <span className="s">{detail}</span>
      </button>

      {open && (
        <ModalOverlay
          onClose={close}
          dismissOnBackdrop={false}
          boxStyle={{ maxWidth, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
        >
          <div className="rf-title">
            {icon}
            {title}
            <span style={{ color: "var(--muted)" }}>· {count}</span>
          </div>
          <p className="rf-subtitle">{subtitle}</p>
          {children(close)}
          <button type="button" className="modal-close" onClick={close}>
            ×
          </button>
        </ModalOverlay>
      )}
    </>
  );
}
