"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import { INPUT_CHROME } from "@/components/ui-styles";

/**
 * Confirmation par mot de passe avant un acte destructeur (constat BAC3).
 *
 * Un cookie de session suffisait à déclencher une restauration de base, une
 * anonymisation en masse ou un changement de rôle : un poste laissé ouvert, une
 * session volée, et l'affaire était jouée. Reprouver son identité ferme cette
 * porte — et impose une seconde de réflexion avant l'irréversible.
 *
 * Composant PARTAGÉ plutôt que sept dialogues distincts : une confirmation qui
 * change de forme d'un écran à l'autre finit par surprendre au mauvais moment,
 * et la logique de vérification n'a pas à être réécrite à chaque fois.
 */
export function ConfirmPasswordModal({
  titre,
  children,
  libelleAction = "Confirmer",
  pending,
  erreur,
  onCancel,
  onConfirm,
}: {
  titre: string;
  /** Rappel de la portée exacte de l'acte — ce qui sera détruit, et si c'est réversible. */
  children: React.ReactNode;
  libelleAction?: string;
  pending: boolean;
  erreur?: string | null;
  onCancel: () => void;
  onConfirm: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <ModalOverlay onClose={onCancel} boxStyle={{ maxWidth: 460 }}>
      <div className="modal-title" style={{ color: "var(--danger)" }}>
        {titre}
      </div>
      <div style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: "1rem" }}>{children}</div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(password);
        }}
      >
        <label
          htmlFor="confirm-pwd"
          style={{ display: "block", fontSize: ".78rem", marginBottom: ".3rem" }}
        >
          Saisissez votre mot de passe pour confirmer
        </label>
        <input
          id="confirm-pwd"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", fontSize: ".85rem", padding: ".35rem .5rem", ...INPUT_CHROME }}
        />
        {erreur && (
          <span className="field-error" style={{ display: "block", marginTop: ".4rem" }}>
            {erreur}
          </span>
        )}
        <div className="btn-row" style={{ marginTop: "1rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || password.length === 0}
            style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
          >
            {pending ? "…" : libelleAction}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
}
