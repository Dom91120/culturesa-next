"use client";

import { type ReactNode, useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";

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
  subtitle,
  maxWidth = 720,
  children,
}: {
  title: string;
  subtitle: string;
  maxWidth?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: ".15rem",
          padding: ".6rem .9rem",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>{subtitle}</span>
      </button>

      {open && (
        <ModalOverlay
          onClose={close}
          dismissOnBackdrop={false}
          boxStyle={{ maxWidth, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
        >
          <div className="modal-title" style={{ marginBottom: "0.75rem" }}>
            {title}
          </div>
          {children(close)}
          <button type="button" className="modal-close" onClick={close}>
            ×
          </button>
        </ModalOverlay>
      )}
    </>
  );
}
