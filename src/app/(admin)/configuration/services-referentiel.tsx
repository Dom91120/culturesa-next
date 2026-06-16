"use client";

import { useEffect, useState } from "react";
import { ServicesEditor } from "../services/services-editor";

type ServiceRow = { id: string; label: string; icon: string | null };

/**
 * Entrée « Services » du panneau Référentiels (page Configuration) : ouvre une MODALE
 * réutilisant `ServicesEditor` (mode tampon, comme Demandeurs).
 */
export function ServicesReferentiel({ services }: { services: ServiceRow[] }) {
  const [open, setOpen] = useState(false);

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
        <span style={{ fontWeight: 600 }}>Services</span>
        <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>Référentiel des services</span>
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
            <div className="modal-title" style={{ marginBottom: 0 }}>
              Services
            </div>
            <ServicesEditor initial={services} onClose={() => setOpen(false)} />
            <button type="button" className="modal-close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
