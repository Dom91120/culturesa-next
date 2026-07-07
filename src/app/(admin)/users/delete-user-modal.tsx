"use client";

import { ModalOverlay } from "@/components/agenda-shared";

/**
 * Modale de confirmation de suppression PHYSIQUE d'un compte vide (0 réservation :
 * test, spam). Rappelle la portée exacte du DELETE et l'irréversibilité — la voie
 * RGPD normale (compte avec historique) reste l'anonymisation.
 */
export function DeleteUserModal({
  name,
  email,
  pending,
  onCancel,
  onConfirm,
}: {
  name: string;
  email: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay onClose={onCancel} boxStyle={{ maxWidth: 460 }}>
      <div className="modal-title" style={{ color: "var(--danger)" }}>
        🗑️ Supprimer définitivement le compte
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".4rem" }}>
        Vous êtes sur le point de supprimer <strong>{name || email}</strong>
        {name ? (
          <>
            {" "}
            (<span style={{ color: "var(--muted)" }}>{email}</span>)
          </>
        ) : null}
        .
      </p>
      <p
        style={{ fontSize: ".78rem", color: "var(--muted)", lineHeight: 1.5, marginBottom: "1rem" }}
      >
        Le compte et ses accès (sessions, identifiants) seront effacés de la base. Cette suppression
        est réservée aux comptes sans réservation (test, spam d&apos;inscription) — elle sera tracée
        dans le journal d&apos;audit RGPD. Pour un compte ayant un historique, utilisez
        l&apos;anonymisation.
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
          onClick={onConfirm}
          disabled={pending}
          style={{ background: "var(--danger)", border: "none", color: "var(--text)" }}
        >
          🗑️ Supprimer définitivement
        </button>
      </div>
    </ModalOverlay>
  );
}
