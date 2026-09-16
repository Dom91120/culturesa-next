"use client";

import { useState } from "react";
import { ModalOverlay } from "@/components/agenda-shared";

/**
 * Choix au DÉPÔT d'une réservation glissée sur un créneau qui en porte déjà (Dom
 * 2026-09-16) : la zone libre d'un créneau est petite et tous les gestionnaires ne
 * distinguent pas « déposer sur le créneau » de « déposer sur une réservation » — la
 * fenêtre lève le doute plutôt que d'agir sur un geste ambigu.
 *
 *  - « Déplacer ici » : la réservation vient à côté des autres (si le créneau a la place) ;
 *  - « Échanger » : elle prend le créneau de la réservation choisie, qui prend le sien, en
 *    une seule transaction (pas d'instant où un créneau est libre — cf. swapBookingsAction).
 *
 * Un créneau SANS réservation ne passe pas par ici : le dépôt y déplace directement.
 */
export type DropCandidate = { id: number; label: string; details: string };

export function BookingDropModal({
  movingLabel,
  targetLabel,
  candidates,
  preselectedId,
  canMove,
  onMove,
  onSwap,
  onCancel,
}: {
  // Réservation glissée (« Mme X », ou sa structure) et créneau visé (« Mardi 14:00 – 15:30 »).
  movingLabel: string;
  targetLabel: string;
  // Réservations déjà sur le créneau visé, échangeables (parentes pour les récurrentes).
  candidates: DropCandidate[];
  // Réservation visée par le dépôt (badge sous le curseur), présélectionnée ; null = zone libre.
  preselectedId: number | null;
  // Le créneau a-t-il la place pour une réservation de plus ? Sinon seul l'échange reste.
  canMove: boolean;
  onMove: () => void;
  onSwap: (otherId: number) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"move" | "swap">(
    canMove && preselectedId == null ? "move" : "swap",
  );
  const [otherId, setOtherId] = useState<number>(preselectedId ?? candidates[0]?.id ?? 0);
  const other = candidates.find((c) => c.id === otherId);
  const radio: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: ".5rem",
    padding: ".45rem .6rem",
    border: "1px solid var(--border)",
    borderRadius: "var(--rad-sm)",
    marginBottom: ".45rem",
    cursor: "pointer",
    textTransform: "none",
    letterSpacing: 0,
    fontWeight: 400,
    fontSize: ".82rem",
    lineHeight: 1.4,
  };
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal-title">⇄ Déposer la réservation</div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".7rem" }}>
        Vous déposez la réservation de <strong>{movingLabel}</strong> sur le créneau{" "}
        <strong>{targetLabel}</strong>, qui porte déjà{" "}
        {candidates.length > 1 ? `${candidates.length} réservations` : "une réservation"}.
      </p>

      <label style={{ ...radio, opacity: canMove ? 1 : 0.55 }}>
        <input
          type="radio"
          name="drop-mode"
          checked={mode === "move"}
          disabled={!canMove}
          onChange={() => setMode("move")}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Déplacer ici, à côté</strong>
          <br />
          <span style={{ color: "var(--muted)", fontSize: ".76rem" }}>
            {canMove
              ? "La réservation vient s'ajouter aux autres ; rien ne change pour elles."
              : "Impossible : le créneau est complet."}
          </span>
        </span>
      </label>

      <label style={radio}>
        <input
          type="radio"
          name="drop-mode"
          checked={mode === "swap"}
          onChange={() => setMode("swap")}
          style={{ marginTop: 3 }}
        />
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong>Échanger les créneaux</strong>
          <br />
          <span style={{ color: "var(--muted)", fontSize: ".76rem" }}>
            {movingLabel} prend ce créneau ; la réservation choisie prend le sien.
          </span>
          {candidates.length > 1 ? (
            <select
              aria-label="Réservation à échanger"
              value={otherId}
              disabled={mode !== "swap"}
              onChange={(e) => setOtherId(Number(e.target.value))}
              style={{ display: "block", marginTop: ".35rem", width: "100%", fontSize: ".8rem" }}
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.details ? ` — ${c.details}` : ""}
                </option>
              ))}
            </select>
          ) : (
            other && (
              <span style={{ display: "block", marginTop: ".3rem", fontSize: ".8rem" }}>
                avec <strong>{other.label}</strong>
                {other.details ? ` — ${other.details}` : ""}
              </span>
            )
          )}
        </span>
      </label>

      <div className="btn-row" style={{ marginTop: ".9rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        {mode === "move" ? (
          <button type="button" className="btn btn-primary" disabled={!canMove} onClick={onMove}>
            Déplacer ici
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!other}
            onClick={() => other && onSwap(other.id)}
          >
            ⇄ Échanger
          </button>
        )}
      </div>
    </ModalOverlay>
  );
}
