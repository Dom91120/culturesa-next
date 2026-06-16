"use client";

import { useEffect, useState } from "react";
import { DemandeursEditor } from "../demandeurs/demandeurs-editor";

type Demandeur = { id: number; label: string; openOnSchoolHolidays: boolean };

/**
 * Entrée « Demandeurs » du panneau Référentiels (page Configuration) : un bouton au même
 * style que les liens Structures/Niveaux, qui ouvre une MODALE réutilisant l'éditeur de
 * l'onglet Administration > Demandeurs (CRUD complet, autosave).
 */
export function DemandeursReferentiel({ demandeurs }: { demandeurs: Demandeur[] }) {
  const [open, setOpen] = useState(false);

  // Fermeture par la touche Échap (uniquement quand la modale est ouverte).
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
        <span style={{ fontWeight: 600 }}>Demandeurs</span>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          Référentiel des demandeurs
        </span>
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
            style={{ maxWidth: 780, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
          >
            <div className="modal-title" style={{ marginBottom: 0 }}>
              Demandeurs
            </div>
            {/* Mode tampon : l'éditeur gère lui-même Annuler/Enregistrer (pas d'autosave). */}
            <DemandeursEditor initial={demandeurs} onClose={() => setOpen(false)} />
            <button type="button" className="modal-close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
