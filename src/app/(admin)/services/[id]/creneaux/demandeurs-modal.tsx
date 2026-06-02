"use client";

import { useState } from "react";

type Demandeur = { id: number; name: string };

type Props = {
  demandeurs: Demandeur[];
  selected: number[];
  onClose: () => void;
  onSave: (ids: number[]) => void;
  saving: boolean;
};

export function DemandeursModal({ demandeurs, selected, onClose, onSave, saving }: Props) {
  const [ids, setIds] = useState<number[]>(selected);

  function toggle(id: number, on: boolean) {
    setIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  return (
    <div className="modal-overlay open">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          background: "transparent",
          border: "none",
          cursor: "default",
        }}
      />
      <div className="modal-box" style={{ position: "relative" }}>
        <h3>Demandeurs autorisés</h3>
        {demandeurs.length === 0 ? (
          <p className="muted">Aucun demandeur autorisé pour ce service.</p>
        ) : (
          <ul className="dem-modal-list">
            {demandeurs.map((d) => (
              <li key={d.id}>
                <label className="day-chk">
                  <input
                    type="checkbox"
                    className="admin-cb"
                    checked={ids.includes(d.id)}
                    onChange={(e) => toggle(d.id, e.target.checked)}
                  />
                  {d.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={() => onSave(ids)}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
