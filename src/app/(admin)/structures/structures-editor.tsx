"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createStructureAction, deleteStructureAction, updateStructureAction } from "./actions";

type DemandeurOption = { id: number; label: string };
type Initial = { id: number; label: string; demandeurId: number; users: number };
type Row = { id: number | null; label: string; demandeurId: number; users: number; key: string };

const GRID = "1fr 170px 64px 80px";

/**
 * Éditeur des structures (modale du référentiel, Administration > Configuration).
 * MODE TAMPON : modifications locales jusqu'au clic sur « Enregistrer ». Chaque structure
 * est rattachée à un demandeur (obligatoire).
 */
export function StructuresEditor({
  initial,
  demandeurs,
  onClose,
}: {
  initial: Initial[];
  demandeurs: DemandeurOption[];
  onClose?: () => void;
}) {
  const counter = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((s) => ({ ...s, key: `db-${s.id}` })));
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [saving, startSaving] = useTransition();

  function patch(key: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function add() {
    const key = `new-${counter.current++}`;
    setRows((rs) => [
      ...rs,
      { id: null, label: "", demandeurId: demandeurs[0]?.id ?? 0, users: 0, key },
    ]);
    setConfirmKey(null);
  }
  function remove(key: string) {
    setConfirmKey(null);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function saveAll() {
    const initialById = new Map(initial.map((s) => [s.id, s]));
    const currentIds = new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
    const toDelete = initial.filter((s) => !currentIds.has(s.id));
    const valid = (r: Row) => r.label.trim() !== "" && r.demandeurId > 0;
    const toCreate = rows.filter((r) => r.id == null && valid(r));
    const toUpdate = rows.filter((r) => {
      if (r.id == null || !valid(r)) return false;
      const init = initialById.get(r.id);
      return !!init && (init.label !== r.label.trim() || init.demandeurId !== r.demandeurId);
    });

    startSaving(async () => {
      try {
        for (const s of toDelete) {
          const res = await deleteStructureAction(s.id);
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toCreate) {
          const res = await createStructureAction({
            label: r.label.trim(),
            demandeurId: r.demandeurId,
          });
          if (!res.ok) throw new Error(res.error);
        }
        for (const r of toUpdate) {
          const res = await updateStructureAction(r.id as number, {
            label: r.label.trim(),
            demandeurId: r.demandeurId,
          });
          if (!res.ok) throw new Error(res.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Échec de l'enregistrement.");
        return;
      }
      router.refresh();
      onClose?.();
    });
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".75rem",
          marginBottom: ".5rem",
        }}
      >
        {error && (
          <span className="field-error" style={{ fontSize: ".72rem" }}>
            {error}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={add}
          disabled={demandeurs.length === 0}
          style={{ fontSize: ".64rem", padding: ".18rem .5rem" }}
        >
          ＋ Ajouter
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: ".75rem",
          alignItems: "center",
          padding: "0 .75rem .5rem",
          fontSize: ".66rem",
          fontWeight: 600,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        <span style={{ paddingLeft: ".5rem" }}>Structure</span>
        <span>Demandeur</span>
        <span style={{ textAlign: "center" }}>Usagers</span>
        <span style={{ textAlign: "center" }}>Action</span>
      </div>

      {rows.map((r) => {
        const confirming = confirmKey === r.key;
        return (
          <div
            key={r.key}
            className="dem-row"
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: ".75rem",
              alignItems: "center",
              padding: ".4rem .75rem",
              borderRadius: "var(--rad-sm)",
              borderTop: "1px solid var(--border)",
            }}
          >
            <input
              type="text"
              className="dem-ghost"
              value={r.label}
              placeholder="Nom de la structure"
              onChange={(e) => patch(r.key, { label: e.target.value })}
              style={{
                fontSize: ".85rem",
                fontWeight: 600,
                color: "var(--text)",
                border: "none",
                background: "transparent",
                outline: "none",
                borderRadius: "var(--rad-sm)",
                padding: ".35rem .5rem",
                width: "100%",
              }}
            />

            {confirming ? (
              <div
                style={{
                  gridColumn: "2 / 5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: ".5rem",
                }}
              >
                <span style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                  Supprimer ? {r.users > 0 && `${r.users} usager(s) détaché(s).`}
                </span>
                <button
                  type="button"
                  onClick={() => remove(r.key)}
                  style={{
                    border: "1px solid var(--danger)",
                    background: "transparent",
                    color: "var(--danger)",
                    borderRadius: "var(--rad-sm)",
                    fontSize: ".72rem",
                    padding: ".2rem .55rem",
                    cursor: "pointer",
                  }}
                >
                  Supprimer
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(null)}
                  style={{ fontSize: ".72rem", padding: ".2rem .55rem" }}
                >
                  Annuler
                </button>
              </div>
            ) : (
              <>
                <select
                  value={r.demandeurId}
                  onChange={(e) => patch(r.key, { demandeurId: Number(e.target.value) })}
                  style={{
                    fontSize: ".78rem",
                    padding: ".2rem .35rem",
                    borderRadius: "var(--rad-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                    color: "var(--text)",
                    width: "100%",
                  }}
                >
                  {demandeurs.length === 0 && <option value={0}>— aucun demandeur —</option>}
                  {demandeurs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span style={{ textAlign: "center", fontSize: ".8rem", color: "var(--muted)" }}>
                  {r.id == null ? "—" : r.users}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmKey(r.key)}
                  title="Supprimer cette structure"
                  style={{
                    fontSize: ".75rem",
                    padding: ".15rem .4rem",
                    lineHeight: 1,
                    color: "#e05555",
                    borderColor: "rgba(220,80,80,.4)",
                    justifySelf: "center",
                  }}
                >
                  🗑️
                </button>
              </>
            )}
          </div>
        );
      })}

      {rows.length === 0 && (
        <div
          style={{
            padding: "1.5rem",
            textAlign: "center",
            fontSize: ".82rem",
            color: "var(--muted)",
            borderTop: "1px solid var(--border)",
          }}
        >
          Aucune structure. Cliquez sur « Ajouter ».
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: ".6rem",
          marginTop: "1.25rem",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onClose?.()}
          disabled={saving}
          style={{ fontSize: ".7rem", padding: ".22rem .65rem" }}
        >
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={saveAll}
          disabled={saving}
          style={{ fontSize: ".7rem", padding: ".22rem .75rem" }}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      <style>
        {
          ".dem-row:hover{background:var(--surface2)}.dem-ghost:hover{background:var(--surface2)}.dem-ghost:focus{background:var(--surface2);box-shadow:inset 0 -2px 0 var(--accent)}"
        }
      </style>
    </div>
  );
}
