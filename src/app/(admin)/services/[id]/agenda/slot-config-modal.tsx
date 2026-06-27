"use client";

import { useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { saveSlotConfigAction } from "./actions";

/**
 * Modale de configuration d'un créneau (mode création) : capacité + demandeurs
 * autorisés. État de formulaire interne (monté via `key={slotId}` côté parent pour
 * être réinitialisé à chaque ouverture). Extrait de agenda-grid (audit, vague 2).
 */
export function SlotConfigModal({
  serviceId,
  slotId,
  title,
  initialCapacity,
  initialDemIds,
  serviceDemandeurs,
  onClose,
  onSaved,
}: {
  serviceId: string;
  slotId: string;
  // Suffixe de titre, ex. « · 9:00–10:30 » (ou "" si le créneau est introuvable).
  title: string;
  initialCapacity: string;
  initialDemIds: number[];
  serviceDemandeurs: { id: number; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [capValue, setCapValue] = useState(initialCapacity);
  const [capDemIds, setCapDemIds] = useState<number[]>(initialDemIds);
  const [capError, setCapError] = useState<string | null>(null);
  const [capSaving, startCapSave] = useTransition();

  function submit() {
    const capacity = Number.parseInt(capValue, 10);
    if (!Number.isFinite(capacity) || capacity < 0) {
      setCapError("Capacité invalide.");
      return;
    }
    setCapError(null);
    startCapSave(async () => {
      const res = await saveSlotConfigAction({
        serviceId,
        slotId,
        capacity,
        demandeurIds: capDemIds,
      });
      if (res && !res.ok) {
        setCapError(res.error ?? "Échec de l'enregistrement.");
        return;
      }
      onSaved();
    });
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal-title">Configuration du créneau{title}</div>
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="cap-input">Capacité (places)</label>
          <input
            id="cap-input"
            type="number"
            min={0}
            value={capValue}
            onChange={(e) => setCapValue(e.target.value)}
          />
        </div>
      </div>
      <div className="field full" style={{ marginTop: ".6rem" }}>
        <span
          style={{
            display: "block",
            fontSize: ".7rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: ".06em",
            color: "var(--muted)",
            marginBottom: ".2rem",
          }}
        >
          Demandeurs autorisés
        </span>
        {serviceDemandeurs.length === 0 ? (
          <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: ".3rem 0 0" }}>
            Aucun demandeur configuré pour ce service.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: ".5rem .9rem",
              marginTop: ".4rem",
            }}
          >
            {serviceDemandeurs.map((d) => (
              <label
                key={d.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: ".35rem",
                  fontSize: ".82rem",
                  fontWeight: 400,
                  color: "var(--text)",
                  textTransform: "none",
                  letterSpacing: "normal",
                }}
              >
                <input
                  type="checkbox"
                  checked={capDemIds.includes(d.id)}
                  onChange={(e) =>
                    setCapDemIds((prev) =>
                      e.target.checked
                        ? [...new Set([...prev, d.id])]
                        : prev.filter((x) => x !== d.id),
                    )
                  }
                  style={{ accentColor: "var(--accent)" }}
                />
                {d.label}
              </label>
            ))}
          </div>
        )}
        <span
          style={{
            display: "block",
            marginTop: ".4rem",
            fontSize: ".72rem",
            fontStyle: "italic",
            color: "var(--muted)",
          }}
        >
          Aucune coche = ouvert à tous les demandeurs.
        </span>
      </div>
      {capError && (
        <p className="field-error" style={{ display: "block" }}>
          {capError}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={capSaving}>
          {capSaving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </ModalOverlay>
  );
}
