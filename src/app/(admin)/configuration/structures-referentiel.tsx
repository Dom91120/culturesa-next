"use client";

import { useEffect, useState } from "react";
import { StructuresEditor } from "../structures/structures-editor";

type DemandeurOption = { id: number; label: string };
type Structure = { id: number; label: string; demandeurId: number; users: number };

/**
 * Entrée « Structures » du panneau Référentiels : ouvre une modale réutilisant
 * `StructuresEditor` (mode tampon). Les structures sont rattachées aux demandeurs.
 */
export function StructuresReferentiel({
  structures,
  demandeurs,
}: {
  structures: Structure[];
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
        <span style={{ fontWeight: 600 }}>Structures</span>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
          Structures rattachées aux demandeurs
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
              Structures
            </div>
            <StructuresEditor
              initial={structures}
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
