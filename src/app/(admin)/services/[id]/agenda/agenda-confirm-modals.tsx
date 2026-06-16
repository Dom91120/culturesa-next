"use client";

import { ModalOverlay } from "@/components/agenda-shared";

/** Confirmation de suppression d'un créneau vide (mode création). */
export function SlotDeleteModal({
  timePart,
  onCancel,
  onConfirm,
}: {
  // Plage horaire « 9:00–10:30 » du créneau, ou "" si inconnue.
  timePart: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal-title" style={{ color: "var(--danger)" }}>
        🗑️ Supprimer le créneau
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
        Vous êtes sur le point de supprimer ce créneau
        {timePart ? (
          <>
            {" "}
            <strong>{timePart}</strong>
          </>
        ) : null}
        .
      </p>
      <p
        style={{ fontSize: ".78rem", color: "var(--danger)", fontWeight: 600, margin: "0 0 1rem" }}
      >
        ⚠️ Cette action est irréversible.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          style={{ background: "var(--danger)", border: "none", color: "var(--text)" }}
        >
          🗑️ Supprimer
        </button>
      </div>
    </ModalOverlay>
  );
}

/** Confirmation de copie des créneaux d'une semaine A/B vers l'autre. */
export function CopyWeekConfirmModal({
  from,
  to,
  onCancel,
  onConfirm,
}: {
  from: "A" | "B";
  to: "A" | "B";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal-title" style={{ color: "var(--warn)" }}>
        Copier les créneaux · Semaine {from} → {to}
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 1rem" }}>
        Les créneaux récurrents de la <strong>semaine {from}</strong> qui n'existent pas encore en{" "}
        <strong>semaine {to}</strong> y seront recréés (capacité et demandeurs autorisés inclus).
        Les créneaux déjà présents en semaine {to} ne sont pas dupliqués.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          style={{ background: "var(--warn)", border: "none", color: "var(--text)" }}
        >
          Valider
        </button>
      </div>
    </ModalOverlay>
  );
}
