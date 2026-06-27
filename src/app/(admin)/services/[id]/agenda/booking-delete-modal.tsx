"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";

/**
 * Modale de confirmation de suppression d'une réservation (port du legacy
 * booking-delete-confirm-modal) : récap (nom + créneau · jour · période · date)
 * et avertissement « action irréversible ».
 */
export function BookingDeleteModal({
  name,
  details,
  recurring,
  validated,
  onCancel,
  onConfirm,
}: {
  name: string;
  details: string;
  recurring: boolean;
  // Réservation déjà validée → le mail parlera de « supprimée » ; sinon « non validée ».
  validated: boolean;
  onCancel: () => void;
  onConfirm: (motif: string) => void;
}) {
  const [motif, setMotif] = useState("");
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal-title" style={{ color: "var(--danger)" }}>
        🗑️ Supprimer la réservation
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".4rem" }}>
        Vous êtes sur le point de supprimer la réservation
        {recurring ? " récurrente" : ""} de <strong>{name}</strong>.
      </p>
      {details && (
        <p style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: "1rem" }}>{details}</p>
      )}
      {/* Motif (facultatif) : joint au mail de notification envoyé à l'usager. */}
      <label
        htmlFor="booking-delete-motif"
        style={{ display: "block", fontSize: ".78rem", fontWeight: 600, marginBottom: ".25rem" }}
      >
        Motif (facultatif)
      </label>
      <textarea
        id="booking-delete-motif"
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Précisez le motif communiqué à l'usager…"
        style={{
          width: "100%",
          resize: "vertical",
          fontSize: ".8rem",
          padding: ".4rem .5rem",
          marginBottom: ".5rem",
          boxSizing: "border-box",
        }}
      />
      <p style={{ fontSize: ".74rem", color: "var(--muted)", marginBottom: "1rem" }}>
        ✉️ Un e-mail informera l'usager que sa réservation{" "}
        {validated ? "a été supprimée" : "n'a pas été validée"}
        {motif.trim() ? ", avec le motif saisi" : ""}.
      </p>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--danger)",
          fontWeight: 600,
          marginBottom: "1rem",
        }}
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
          onClick={() => onConfirm(motif.trim())}
          style={{ background: "var(--danger)", border: "none", color: "var(--text)" }}
        >
          🗑️ Supprimer
        </button>
      </div>
    </ModalOverlay>
  );
}
