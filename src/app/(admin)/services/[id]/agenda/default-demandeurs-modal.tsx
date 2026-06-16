"use client";

import { ModalOverlay } from "@/components/agenda-shared";

/**
 * Modale (mode création) du choix des demandeurs autorisés PAR DÉFAUT des créneaux
 * créés. Contrôlée : la sélection (`selected`) vit dans le parent (réutilisée à la
 * création des créneaux + badge). Extrait de agenda-grid (audit, vague 2).
 */
export function DefaultDemandeursModal({
  serviceDemandeurs,
  selected,
  onChange,
  onClose,
}: {
  serviceDemandeurs: { id: number; label: string }[];
  selected: number[];
  onChange: (next: number[]) => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div className="modal-title">Demandeurs autorisés par défaut</div>
      <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: "0 0 .6rem" }}>
        Appliqués aux créneaux que vous créez. Aucune coche = ouvert à tous.
      </p>
      {serviceDemandeurs.length === 0 ? (
        <p style={{ fontSize: ".8rem", color: "var(--muted)" }}>
          Aucun demandeur configuré pour ce service.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem .9rem" }}>
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
                checked={selected.includes(d.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...new Set([...selected, d.id])]
                      : selected.filter((x) => x !== d.id),
                  )
                }
                style={{ accentColor: "var(--accent)" }}
              />
              {d.label}
            </label>
          ))}
        </div>
      )}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onChange([])}
          disabled={selected.length === 0}
        >
          Tout décocher
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          OK
        </button>
      </div>
    </ModalOverlay>
  );
}
