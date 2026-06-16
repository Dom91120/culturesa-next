"use client";

import { useEffect, useState } from "react";
import { NiveauxEditor } from "../niveaux/niveaux-editor";

type DemandeurOption = { id: number; label: string };
type Niveau = { id: number; label: string; demandeurId: number | null; position: number };

/**
 * Entrée « Niveaux » du panneau Référentiels : ouvre une modale réutilisant `NiveauxEditor`
 * (mode tampon). Demandeur optionnel, position d'ordre.
 */
export function NiveauxReferentiel({
  niveaux,
  demandeurs,
}: {
  niveaux: Niveau[];
  demandeurs: DemandeurOption[];
}) {
  const [open, setOpen] = useState(false);

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
        <span style={{ fontWeight: 600 }}>Niveaux</span>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          Référentiel des niveaux scolaires
        </span>
      </button>

      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: fermeture clavier gérée globalement (Échap)
        <div
          className="modal-overlay open"
          style={{ display: "flex" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 720, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
          >
            <div className="modal-title" style={{ marginBottom: "0.75rem" }}>
              Niveaux
            </div>
            <NiveauxEditor
              initial={niveaux}
              demandeurs={demandeurs}
              onClose={() => setOpen(false)}
            />
            <button type="button" className="modal-close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
