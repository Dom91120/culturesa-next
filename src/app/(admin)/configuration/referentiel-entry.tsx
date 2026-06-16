"use client";

import { type ReactNode, useEffect, useState } from "react";

/**
 * Entrée du panneau Référentiels (page Configuration) : un bouton (titre + sous-titre)
 * qui ouvre une MODALE (fermeture par Échap + clic sur le fond) hébergeant un éditeur en
 * mode tampon. Mutualise les wrappers services/demandeurs/structures/niveaux (audit R2).
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

  // Fermeture par Échap (uniquement quand la modale est ouverte).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
        // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture clavier gérée globalement (Échap)
        <div
          className="modal-overlay open"
          style={{ display: "flex" }}
          // Clic sur le fond (hors de la boîte) → ferme la modale.
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal-box"
            style={{ maxWidth, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
          >
            <div className="modal-title" style={{ marginBottom: "0.75rem" }}>
              {title}
            </div>
            {children(close)}
            <button type="button" className="modal-close" onClick={close}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
