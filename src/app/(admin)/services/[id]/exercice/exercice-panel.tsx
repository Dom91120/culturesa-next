"use client";

import type { ExercicePaneData } from "@/server/services/exercice";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cycleAction, setShowPreviousExercicesAction, undoCycleAction } from "./actions";

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
  const [showPrevious, setShowPrevious] = useState(data.showPreviousExercices);

  const bookingsCount = data.undo.bookingsCount;
  const undoButtonReady = bookingsCount === 0 || undoAck;

  function toggleMode(next: Exclude<Mode, "none">) {
    setError(null);
    setInfo(null);
    setUndoAck(false);
    setMode((prev) => (prev === next ? "none" : next));
  }

  function handleCreate() {
    setError(null);
    setInfo(null);
    if (!data.hasActivePeriods) return;
    const ok = window.confirm(
      `Créer l'exercice ${data.nextName} ? Pour chaque période active, une nouvelle période sera créée (dates décalées d'un an) et l'originale sera désactivée.`,
    );
    if (!ok) return;
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

  function handleUndo() {
    setError(null);
    setInfo(null);
    const ok = window.confirm(
      `Supprimer l'exercice ${data.currentName} ? Cette action supprime définitivement les périodes, créneaux et ${bookingsCount} réservation(s), puis restaure l'exercice précédent.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await undoCycleAction(serviceId);
      if (!res || !res.ok) {
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
    background: "var(--surface-2)",
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
        <label className="check" style={{ fontSize: ".62rem" }}>
          <input
            type="checkbox"
            checked={showPrevious}
            disabled={isPending}
            onChange={(e) => {
              const next = e.target.checked;
              setShowPrevious(next); // optimiste
              startTransition(async () => {
                const res = await setShowPreviousExercicesAction(serviceId, next);
                if (!res || !res.ok) {
                  setShowPrevious(!next); // rollback
                  setError(res?.error ?? "Échec de l'enregistrement.");
                  return;
                }
                router.refresh();
              });
            }}
          />{" "}
          Afficher les exercices précédents
        </label>
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
              onClick={handleCreate}
            >
              Créer l&apos;exercice {data.nextName}
            </button>
          </div>
        ) : null}

        {mode === "undo" && data.undo.hasUndo ? (
          <div className="panel" style={columnStyle}>
            <div className="panel-title">Retour à l&apos;année précédente</div>
            <p style={{ fontSize: ".85rem", color: "var(--muted)", marginTop: 6 }}>
              Supprime entièrement l&apos;exercice en cours (périodes, créneaux ET réservations) et
              restaure le précédent.
            </p>
            <p
              style={{
                color: bookingsCount > 0 ? "var(--danger)" : "var(--ok)",
                border: `1px solid ${bookingsCount > 0 ? "var(--danger)" : "var(--ok)"}`,
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                fontSize: ".85rem",
                margin: "12px 0",
              }}
            >
              {bookingsCount > 0
                ? `${bookingsCount} réservation(s) seront supprimées`
                : "Aucune réservation existante"}
            </p>
            {bookingsCount > 0 ? (
              <label className="check" style={{ marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={undoAck}
                  disabled={isPending}
                  onChange={(e) => setUndoAck(e.target.checked)}
                />{" "}
                J&apos;ai compris : {bookingsCount} réservations seront supprimées
              </label>
            ) : null}
            <button
              type="button"
              className="btn btn-danger"
              style={
                bookingsCount === 0
                  ? {
                      background: "var(--warn)",
                      borderColor: "var(--warn)",
                      color: "#1b1300",
                    }
                  : undefined
              }
              disabled={isPending || !undoButtonReady}
              onClick={handleUndo}
            >
              Supprimer l&apos;exercice {data.currentName}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
