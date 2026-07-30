"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { INPUT_CHROME } from "@/components/ui-styles";

/**
 * Modale de confirmation d'anonymisation RGPD d'un compte (voie normale pour un
 * compte avec historique, ≠ suppression physique). Rappelle la portée exacte :
 * données personnelles neutralisées, réservations conservées, irréversible.
 */
export function AnonymizeUserModal({
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
  onConfirm: (password: string) => void;
}) {
  // Ré-authentification avant un acte irréversible (constat BAC3).
  const [password, setPassword] = useState("");

  return (
    <ModalOverlay onClose={onCancel} boxStyle={{ maxWidth: 460 }}>
      <div className="modal-title" style={{ color: "var(--warn)" }}>
        🗑️ Anonymiser le compte
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".4rem" }}>
        Vous êtes sur le point d&apos;anonymiser <strong>{name || email}</strong>
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
        Les données personnelles (nom, e-mail, téléphone…) seront remplacées par des valeurs neutres
        et le compte sera déconnecté et détaché de sa structure. Les réservations sont conservées
        pour l&apos;historique et les statistiques, rattachées à un compte devenu non identifiable
        (RGPD). L&apos;opération sera tracée dans le journal d&apos;audit.
      </p>
      <p
        style={{
          fontSize: ".78rem",
          color: "var(--warn)",
          fontWeight: 600,
          marginBottom: "1rem",
        }}
      >
        ⚠️ Cette action est irréversible : le compte ne pourra plus être ré-identifié.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(password);
        }}
      >
        <label
          htmlFor="anon-pwd"
          style={{ display: "block", fontSize: ".78rem", marginBottom: ".3rem" }}
        >
          Saisissez votre mot de passe pour confirmer
        </label>
        <input
          id="anon-pwd"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", fontSize: ".85rem", padding: ".35rem .5rem", ...INPUT_CHROME }}
        />
        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || password.length === 0}
            style={{ background: "var(--warn)", border: "none", color: "var(--text)" }}
          >
            🗑️ Anonymiser
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
}
