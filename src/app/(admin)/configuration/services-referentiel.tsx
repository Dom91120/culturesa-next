"use client";

import { useEffect, useState } from "react";
import { ServicesManager } from "../services/services-manager";

type ServiceRow = { id: string; label: string; icon: string | null };

/**
 * Entrée « Services » du panneau Référentiels (page Configuration) : un bouton au même
 * style que les autres référentiels, qui ouvre une MODALE réutilisant `ServicesManager`
 * (même écran que l'onglet Administration > Services : table, ajout, modifier, supprimer).
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
          // Clic sur le fond (hors de la boîte) → ferme la modale.
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 720, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
          >
            {/* ServicesManager fournit son propre en-tête « Configuration des services ». */}
            <ServicesManager services={services} embedded onClose={() => setOpen(false)} />
            <button type="button" className="modal-close" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
