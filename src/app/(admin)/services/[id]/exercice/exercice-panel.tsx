"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ModalOverlay } from "@/components/agenda-shared";
import type { ExercicePaneData } from "@/server/services/exercice";
import { cycleAction, undoCycleAction } from "./actions";

type Props = {
  serviceId: string;
  data: ExercicePaneData;
};

type Mode = "none" | "create" | "undo";

export function ExercicePanel({ serviceId, data }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("none");
  const [recreatePeriods, setRecreatePeriods] = useState(true);
  const [recreateSlots, setRecreateSlots] = useState(true);
  const [undoAck, setUndoAck] = useState(false);
  // Modale de confirmation ouverte (port des modales legacy exercice-create/delete-confirm).
  const [confirm, setConfirm] = useState<"create" | "undo" | null>(null);

  const bookingsCount = data.undo.bookingsCount;
  const undoButtonReady = bookingsCount === 0 || undoAck;
  // Teinte de la section « supprimer le dernier exercice » : danger (rouge) si la
  // suppression entraîne la perte de réservations, warn (orange) sinon (port legacy).
  const undoAccent = bookingsCount > 0 ? "var(--danger)" : "var(--warn)";

  function toggleMode(next: Exclude<Mode, "none">) {
    setError(null);
    setInfo(null);
    setUndoAck(false);
    setMode((prev) => (prev === next ? "none" : next));
  }

  // Ouvre la modale de confirmation de création (remplace window.confirm).
  function askCreate() {
    setError(null);
    setInfo(null);
    if (!data.hasActivePeriods) return;
    setConfirm("create");
  }

  function doCreate() {
    setConfirm(null);
    startTransition(async () => {
      const res = await cycleAction(serviceId, recreatePeriods, recreateSlots);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInfo(
        `Exercice créé : ${res.created} période(s), ${res.slotsCreated} créneau(x) récurrent(s).`,
      );
      setMode("none");
      router.refresh();
    });
  }

  // Ouvre la modale de confirmation de suppression (remplace window.confirm).
  function askUndo() {
    setError(null);
    setInfo(null);
    setConfirm("undo");
  }

  function doUndo() {
    setConfirm(null);
    startTransition(async () => {
      const res = await undoCycleAction(serviceId);
      if (!res?.ok) {
        setError(res?.error ?? "Échec de l'annulation.");
        return;
      }
      setInfo("Exercice supprimé, retour à l'année précédente effectué.");
      setMode("none");
      setUndoAck(false);
      router.refresh();
    });
  }

  const headerRow = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap" as const,
  };
  const columnsRow = {
    display: "flex",
    gap: 16,
    marginTop: 16,
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  };
  const columnStyle = {
    background: "var(--surface2)",
    flex: 1,
    minWidth: 280,
  };

  return (
    <div className="panel">
      <div style={headerRow}>
        <div>
          <div className="panel-title">
            <span className="dot" style={{ background: "var(--warn)" }} />🔄 Changement
            d&apos;exercice
          </div>
          <p style={{ margin: "6px 0 0", fontSize: ".9rem" }}>
            Dernier exercice : <strong>{data.currentName}</strong>
            {data.currentRange ? (
              <span className="muted">
                {" "}
                ({data.currentRange.start} → {data.currentRange.end})
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {error ? (
        <p className="error-text" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}
      {info ? <p style={{ color: "var(--ok)", marginTop: 12, fontSize: ".9rem" }}>{info}</p> : null}

      <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
        <label className="check">
          <input
            type="checkbox"
            checked={mode === "create"}
            disabled={isPending}
            onChange={() => toggleMode("create")}
          />{" "}
          Créer un nouvel exercice
        </label>
        {data.undo.hasUndo ? (
          <label className="check">
            <input
              type="checkbox"
              checked={mode === "undo"}
              disabled={isPending}
              onChange={() => toggleMode("undo")}
            />{" "}
            Supprimer le dernier exercice
          </label>
        ) : null}
      </div>

      <div style={columnsRow}>
        {mode === "create" ? (
          <div className="panel" style={columnStyle}>
            <div className="panel-title">Création d&apos;un nouvel exercice</div>
            <p style={{ fontSize: ".85rem", color: "var(--muted)", marginTop: 6 }}>
              Pour chaque période active : une nouvelle période sera créée avec des dates décalées
              d&apos;un an. L&apos;originale sera désactivée mais conservée.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: "12px 0",
              }}
            >
              <label className="check">
                <input
                  type="checkbox"
                  checked={recreatePeriods}
                  disabled={isPending}
                  onChange={(e) => setRecreatePeriods(e.target.checked)}
                />{" "}
                Recréer les périodes à l&apos;identique
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={recreateSlots}
                  disabled={isPending}
                  onChange={(e) => setRecreateSlots(e.target.checked)}
                />{" "}
                Recréer les créneaux récurrents à l&apos;identique
              </label>
            </div>
            {data.hasActivePeriods ? null : (
              <p
                style={{
                  color: "var(--warn)",
                  border: "1px solid var(--warn)",
                  borderRadius: "var(--radius)",
                  padding: "8px 12px",
                  fontSize: ".85rem",
                }}
              >
                Aucune période active à reconduire
              </p>
            )}
            <button
              type="button"
              className="btn primary"
              style={{ background: "var(--accent)", borderColor: "var(--accent)" }}
              disabled={isPending || !data.hasActivePeriods}
              onClick={askCreate}
            >
              Créer l&apos;exercice {data.nextName}
            </button>
          </div>
        ) : null}

        {mode === "undo" && data.undo.hasUndo ? (
          <div style={{ flex: 1, minWidth: 280 }}>
            {/* Libellé « utilisateur expérimenté » au-dessus de la boîte, affiché
                seulement si des réservations seront perdues (port legacy #pc-undo-label). */}
            {bookingsCount > 0 ? (
              <div
                style={{
                  fontWeight: 700,
                  color: "var(--danger)",
                  fontSize: ".78rem",
                  margin: "0 0 .35rem",
                }}
              >
                ⚠️ Utilisateur expérimenté :
              </div>
            ) : null}
            {/* Boîte (port legacy #pc-undo-section) : bordure + fond surface2. */}
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--rad-sm)",
                padding: ".75rem 1rem",
                background: "var(--surface2)",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: ".85rem",
                  color: undoAccent,
                  marginBottom: ".4rem",
                }}
              >
                ↩ Retour à l&apos;année précédente
              </div>
              <p
                style={{
                  fontSize: ".85rem",
                  lineHeight: 1.55,
                  color: "var(--text)",
                  marginBottom: ".5rem",
                }}
              >
                Supprime entièrement l&apos;exercice en cours (périodes, créneaux et réservations
                compris). Restaure l&apos;exercice précédent.
              </p>
              <p
                style={{
                  fontSize: ".78rem",
                  lineHeight: 1.5,
                  marginBottom: ".6rem",
                  color: bookingsCount > 0 ? "var(--danger)" : "var(--accent)",
                }}
              >
                {bookingsCount > 0
                  ? `⚠️ ${bookingsCount} réservation${bookingsCount > 1 ? "s" : ""} seront supprimées.`
                  : "✓ Aucune réservation existante."}
              </p>
              {bookingsCount > 0 ? (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    fontSize: ".78rem",
                    color: "var(--text)",
                    cursor: "pointer",
                    userSelect: "none",
                    marginBottom: ".6rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={undoAck}
                    disabled={isPending}
                    onChange={(e) => setUndoAck(e.target.checked)}
                    style={{ accentColor: "var(--danger)", cursor: "pointer" }}
                  />
                  <span>
                    J&apos;ai compris : {bookingsCount} réservation{bookingsCount > 1 ? "s" : ""}{" "}
                    seront supprimées.
                  </span>
                </label>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  fontSize: ".7rem",
                  padding: ".3rem .7rem",
                  background: undoAccent,
                  border: "none",
                  color: "var(--text)",
                }}
                disabled={isPending || !undoButtonReady}
                onClick={askUndo}
              >
                Supprimer l&apos;exercice {data.currentName}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {confirm === "create" ? (
        <ModalOverlay onClose={() => setConfirm(null)}>
          <div className="modal-title" style={{ color: "var(--accent)" }}>
            🔄 Créer un nouvel exercice
          </div>
          <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".75rem" }}>
            Vous êtes sur le point de créer <strong>l&apos;exercice {data.nextName}</strong>. Les
            périodes actives de l&apos;exercice actuel seront recréées avec les dates décalées
            d&apos;un an, et l&apos;exercice en cours sera désactivé (mais conservé dans
            l&apos;historique).
          </p>
          <p
            style={{
              fontSize: ".78rem",
              color: "var(--accent)",
              fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            Confirmer la création ?
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={doCreate}
              style={{ background: "var(--accent)", borderColor: "var(--accent)" }}
            >
              Créer
            </button>
          </div>
        </ModalOverlay>
      ) : null}

      {confirm === "undo" ? (
        <ModalOverlay onClose={() => setConfirm(null)}>
          <div
            className="modal-title"
            style={{ color: bookingsCount > 0 ? "var(--danger)" : "var(--warn)" }}
          >
            ↩ Supprimer l&apos;exercice en cours
          </div>
          <p style={{ fontSize: ".85rem", lineHeight: 1.5, marginBottom: ".75rem" }}>
            Vous êtes sur le point de supprimer définitivement{" "}
            <strong>l&apos;exercice {data.currentName}</strong>. Toutes ses périodes et créneaux
            récurrents seront perdus
            {bookingsCount > 0 ? `, ainsi que ${bookingsCount} réservation(s)` : ""}, et
            l&apos;exercice précédent sera restauré.
          </p>
          <p
            style={{
              fontSize: ".78rem",
              color: bookingsCount > 0 ? "var(--danger)" : "var(--warn)",
              fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            ⚠️ Cette action est irréversible. Confirmer la suppression ?
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={doUndo}
              style={{
                background: bookingsCount > 0 ? "var(--danger)" : "var(--warn)",
                border: "none",
                color: "var(--text)",
              }}
            >
              🗑️ Supprimer
            </button>
          </div>
        </ModalOverlay>
      ) : null}
    </div>
  );
}
