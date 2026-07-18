"use client";

import { ModalOverlay } from "@/components/agenda-shared";

/**
 * Confirmation de suppression d'un créneau vide (mode création). En « Création
 * multiple », si le créneau ponctuel a des JUMEAUX sur la période (mêmes jour,
 * horaires, capacité, jauge et demandeurs — parité A/B respectée), la modale
 * propose de ne supprimer que ce créneau OU toute la série (`seriesCount` +
 * `onConfirmSeries` fournis par la grille).
 */
export function SlotDeleteModal({
  timePart,
  recurring = false,
  seriesCount,
  onCancel,
  onConfirm,
  onConfirmSeries,
}: {
  // Plage horaire « 9:00–10:30 » du créneau, ou "" si inconnue.
  timePart: string;
  // Créneau récurrent : sa suppression retire le créneau ET toutes ses occurrences
  // (toutes les semaines de la période). Sert au message d'avertissement.
  recurring?: boolean;
  // Nombre TOTAL de créneaux identiques sur la période (référence incluse) —
  // fourni seulement quand l'option « toute la série » a un sens (> 1).
  seriesCount?: number;
  onCancel: () => void;
  onConfirm: () => void;
  onConfirmSeries?: () => void;
}) {
  const hasSeries = !!onConfirmSeries && (seriesCount ?? 0) > 1;
  return (
    <ModalOverlay onClose={onCancel}>
      <div className="modal-title" style={{ color: "var(--danger)" }}>
        🗑️ Supprimer le créneau
      </div>
      <p style={{ fontSize: ".85rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
        Vous êtes sur le point de supprimer ce créneau
        {recurring ? " récurrent" : null}
        {timePart ? (
          <>
            {" "}
            <strong>{timePart}</strong>
          </>
        ) : null}
        .
      </p>
      {recurring ? (
        <p style={{ fontSize: ".8rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
          Ce créneau est <strong>récurrent</strong> : sa suppression retire le créneau et{" "}
          <strong>toutes ses occurrences</strong> (toutes les semaines de la période).
        </p>
      ) : null}
      {hasSeries ? (
        <p style={{ fontSize: ".8rem", lineHeight: 1.5, margin: "0 0 .4rem" }}>
          Création multiple : ce créneau existe en <strong>{seriesCount} exemplaires</strong>{" "}
          identiques sur la période (même jour, mêmes horaires, capacité, jauge et demandeurs —
          semaine A/B respectée). Que souhaitez-vous supprimer ?
        </p>
      ) : null}
      <p
        style={{ fontSize: ".78rem", color: "var(--danger)", fontWeight: 600, margin: "0 0 1rem" }}
      >
        ⚠️ Cette action est irréversible.
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        {hasSeries ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onConfirm}
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
            >
              Ce créneau uniquement
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirmSeries}
              style={{ background: "var(--danger)", border: "none", color: "var(--text)" }}
            >
              🗑️ Les {seriesCount} créneaux
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            style={{ background: "var(--danger)", border: "none", color: "var(--text)" }}
          >
            🗑️ Supprimer
          </button>
        )}
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
